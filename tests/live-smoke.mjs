import fs from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";

const base = process.env.AIEIA_LIVE_URL || "https://ai-evidence-in-action.netlify.app";
const keyDoc = JSON.parse(fs.readFileSync("src/.well-known/ai-evidence-in-action-keys.json", "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function fetchRecord(mode, claimId, requestId) {
  const response = await fetch(`${base}/api/demo-record`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, claim_id: claimId, request_id: requestId, order_id: "ORD-1042", amount_cents: 6400 })
  });
  const body = await response.json();
  if (!response.ok || !body?.ok || !body.record) throw new Error(`demo-record ${mode} failed: ${response.status} ${JSON.stringify(body)}`);
  verifyRecord(body.record);
  return body.record;
}

let lastError;
for (let attempt = 1; attempt <= 24; attempt += 1) {
  try {
    const page = await fetch(`${base}/`, { cache: "no-store" });
    const html = await page.text();
    if (!page.ok || !html.includes("AI Evidence in Action") || !html.includes("Verify signatures")) throw new Error("production page is not the signed-evidence build yet");
    const id = `${Date.now()}-${attempt}`;
    const site = await fetchRecord("site", `clm_ci_${id}`, `req_ci_${id}`);
    const destination = await fetchRecord("destination", site.claim_id, site.request_id);
    if (site.statement !== "SUCCESS_DECLARED") throw new Error(`unexpected site statement ${site.statement}`);
    if (destination.statement !== "ACTION_ABSENT") throw new Error(`unexpected destination statement ${destination.statement}`);
    console.log(JSON.stringify({ live_smoke: "PASS", base, site_key: site.integrity.key_id, destination_key: destination.integrity.key_id }));
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(`attempt ${attempt}/24: ${error.message}`);
    if (attempt < 24) await sleep(5000);
  }
}

console.error(`live smoke failed: ${lastError?.message || lastError}`);
process.exit(1);
