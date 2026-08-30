import { createHash, createHmac, createPrivateKey, sign } from "node:crypto";

const SCHEMA = "ai-evidence-in-action/demo-evidence/1";
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const MAX_BODY_BYTES = 4096;

/**
 * The fixture table is the only thing that decides what a record says. A caller
 * selects one of these named fixtures; it never supplies a statement, a subject,
 * or any other signed field. A fixture whose destination entry is null models a
 * source that returns no evidence at all, which is the only honest way to reach
 * INSUFFICIENT_EVIDENCE: the destination record does not exist rather than
 * existing and saying nothing.
 */
const FIXTURES = {
  disagreement: { site: "SUCCESS_DECLARED", destination: "ACTION_ABSENT" },
  agreement: { site: "SUCCESS_DECLARED", destination: "ACTION_PRESENT" },
  insufficient_evidence: { site: "SUCCESS_DECLARED", destination: null }
};
const DEFAULT_SCENARIO = "disagreement";
const SUBJECT = { order_id: "ORD-1042", amount_cents: 6400, currency: "USD" };

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function fail(status, code, message) {
  return json(status, { ok: false, error: { code, message } });
}

function safeId(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`${name} must be 1-128 safe identifier characters.`);
  }
  return value;
}

function derivePrivateKey(rootBytes, keyId) {
  const seed = createHmac("sha256", rootBytes).update(`ai-evidence-in-action/${keyId}`).digest();
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
}

function signRecord(record, rootBytes, keyId) {
  const canonical = canonicalize(record);
  const digest = createHash("sha256").update(canonical).digest();
  const signature = sign(null, digest, derivePrivateKey(rootBytes, keyId));
  return {
    ...record,
    integrity: {
      status: "SIGNED",
      algorithm: "Ed25519",
      digest: "SHA-256",
      payload_sha256: digest.toString("hex"),
      sig_ed25519: signature.toString("base64"),
      key_id: keyId
    }
  };
}

export default async (req) => {
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "POST is required.");
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return fail(413, "PAYLOAD_TOO_LARGE", "Demo request is too large.");

  // The declared length is a hint, not a guarantee. Measure the bytes actually read.
  let raw;
  try {
    raw = await req.text();
  } catch {
    return fail(400, "MALFORMED_JSON", "Request body could not be read.");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return fail(413, "PAYLOAD_TOO_LARGE", "Demo request is too large.");

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "MALFORMED_JSON", "Request body must be valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "MALFORMED_JSON", "Request body must be a JSON object.");
  }

  const rootB64 = Netlify.env.get("AIEIA_SITE_SIGNING_KEY_PKCS8_B64");
  if (!rootB64) return fail(503, "DEMO_SIGNING_UNAVAILABLE", "Demo signing is temporarily unavailable.");

  let claimId;
  let requestId;
  try {
    claimId = safeId(body.claim_id, "claim_id");
    requestId = safeId(body.request_id, "request_id");
  } catch (error) {
    return fail(400, "IDENTIFIER_INVALID", error.message);
  }

  if (!["site", "destination"].includes(body.mode)) {
    return fail(400, "MODE_INVALID", "mode must be site or destination.");
  }
  const scenario = body.scenario === undefined ? DEFAULT_SCENARIO : body.scenario;
  if (typeof scenario !== "string" || !Object.prototype.hasOwnProperty.call(FIXTURES, scenario)) {
    return fail(400, "SCENARIO_INVALID", `scenario must be one of: ${Object.keys(FIXTURES).join(", ")}.`);
  }
  if (body.order_id !== SUBJECT.order_id || body.amount_cents !== SUBJECT.amount_cents) {
    return fail(400, "DEMO_INPUT_INVALID", "This public demo only supports synthetic order ORD-1042 for $64.00.");
  }

  const isSite = body.mode === "site";
  const statement = isSite ? FIXTURES[scenario].site : FIXTURES[scenario].destination;
  if (statement === null) {
    return fail(503, "DESTINATION_EVIDENCE_UNAVAILABLE", "In this synthetic fixture the simulated destination returns no evidence. No failure outcome is inferred.");
  }

  const keyId = isSite ? "site-demo-2026" : "destination-demo-2026";
  const record = {
    schema: SCHEMA,
    record_id: `rec_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    record_type: isSite ? "site_claim" : "destination_report",
    claim_id: claimId,
    request_id: requestId,
    scenario,
    source: { id: isSite ? "site-demo" : "destination-demo", origin: new URL(req.url).origin },
    statement,
    subject: { ...SUBJECT },
    observed_at: new Date().toISOString()
  };

  return json(200, { ok: true, record: signRecord(record, Buffer.from(rootB64, "base64"), keyId) });
};

export const config = { path: "/api/demo-record" };
