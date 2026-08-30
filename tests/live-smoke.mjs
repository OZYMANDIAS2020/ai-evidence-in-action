import fs from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";

const base = process.env.AIEIA_LIVE_URL || "https://ai-evidence-in-action.netlify.app";
const attempts = Number(process.env.AIEIA_LIVE_ATTEMPTS || 24);
const keyDoc = JSON.parse(fs.readFileSync("src/.well-known/ai-evidence-in-action-keys.json", "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STATEMENT_CORRESPONDENCE = { SUCCESS_DECLARED: { ACTION_PRESENT: true, ACTION_ABSENT: false } };
const SUBJECT_FIELDS = ["order_id", "amount_cents", "currency"];

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function verifyRecord(record) {
  const { integrity, ...payload } = record;
  if (!integrity || integrity.status !== "SIGNED") throw new Error("record is not signed");
  const keyB64 = keyDoc.keys?.[integrity.key_id]?.spki_base64;
  if (!keyB64) throw new Error(`unknown public key ${integrity.key_id}`);
  const digest = createHash("sha256").update(canonicalize(payload)).digest();
  if (digest.toString("hex") !== integrity.payload_sha256) throw new Error("payload hash mismatch");
  const key = createPublicKey({ key: Buffer.from(keyB64, "base64"), format: "der", type: "spki" });
  if (!verify(null, digest, key, Buffer.from(integrity.sig_ed25519, "base64"))) throw new Error("signature verification failed");
}

function compareRecords(site, destination) {
  if (!site || !destination) return { verdict: "INSUFFICIENT_EVIDENCE" };
  const correspondence = STATEMENT_CORRESPONDENCE[site.statement]?.[destination.statement];
  if (correspondence === undefined) return { verdict: "INSUFFICIENT_EVIDENCE" };
  const subjectMatches = SUBJECT_FIELDS.every((field) => site.subject?.[field] === destination.subject?.[field]);
  return { verdict: correspondence && subjectMatches ? "AGREEMENT" : "DISAGREEMENT" };
}

async function post(mode, claimId, requestId, scenario) {
  const response = await fetch(`${base}/api/demo-record`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, claim_id: claimId, request_id: requestId, order_id: "ORD-1042", amount_cents: 6400, scenario })
  });
  return { status: response.status, body: await response.json() };
}

async function fetchRecord(mode, claimId, requestId, scenario) {
  const { status, body } = await post(mode, claimId, requestId, scenario);
  if (status !== 200 || !body?.ok || !body.record) throw new Error(`demo-record ${mode}/${scenario} failed: ${status} ${JSON.stringify(body)}`);
  verifyRecord(body.record);
  if (body.record.scenario !== scenario) throw new Error(`record scenario ${body.record.scenario} does not match requested ${scenario}`);
  return body.record;
}

/** Runs one named fixture end to end against production and returns its verdict. */
async function runScenario(scenario, id) {
  const site = await fetchRecord("site", `clm_ci_${id}`, `req_ci_${id}`, scenario);
  if (site.statement !== "SUCCESS_DECLARED") throw new Error(`unexpected site statement ${site.statement}`);

  if (scenario === "insufficient_evidence") {
    const { status, body } = await post("destination", site.claim_id, site.request_id, scenario);
    if (status !== 503 || body?.error?.code !== "DESTINATION_EVIDENCE_UNAVAILABLE") {
      throw new Error(`insufficient_evidence fixture returned ${status} ${JSON.stringify(body)}`);
    }
    return compareRecords(site, null).verdict;
  }

  const destination = await fetchRecord("destination", site.claim_id, site.request_id, scenario);
  return compareRecords(site, destination).verdict;
}

const EXPECTED = {
  disagreement: "DISAGREEMENT",
  agreement: "AGREEMENT",
  insufficient_evidence: "INSUFFICIENT_EVIDENCE"
};

let lastError;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const page = await fetch(`${base}/`, { cache: "no-store" });
    const html = await page.text();
    if (!page.ok || !html.includes("AI Evidence in Action") || !html.includes("Verify signatures")) throw new Error("production page is not the signed-evidence build yet");
    if (!html.includes("DEMO DESTINATION CLAIM")) throw new Error("production page is not the current comparison build yet");
    if (page.headers.get("x-content-type-options") !== "nosniff") throw new Error("missing nosniff security header");
    if (page.headers.get("x-frame-options") !== "DENY") throw new Error("missing DENY framing policy");
    if (!page.headers.get("content-security-policy")?.includes("default-src 'self'")) throw new Error("missing restrictive content security policy");

    const verdicts = {};
    for (const scenario of Object.keys(EXPECTED)) {
      const id = `${Date.now()}-${attempt}-${scenario}`;
      verdicts[scenario] = await runScenario(scenario, id);
      if (verdicts[scenario] !== EXPECTED[scenario]) throw new Error(`${scenario} produced ${verdicts[scenario]}, expected ${EXPECTED[scenario]}`);
    }

    const rejected = await post("site", "clm_ci_reject", "req_ci_reject", "always_agree");
    if (rejected.status !== 400 || rejected.body?.error?.code !== "SCENARIO_INVALID") throw new Error(`unknown scenario was not refused: ${rejected.status}`);

    console.log(JSON.stringify({ live_smoke: "PASS", base, verdicts }));
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(`attempt ${attempt}/${attempts}: ${error.message}`);
    if (attempt < attempts) await sleep(5000);
  }
}

console.error(`live smoke failed: ${lastError?.message || lastError}`);
process.exit(1);
