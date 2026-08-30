import { createHash, createHmac, createPrivateKey, sign } from "node:crypto";

const SCHEMA = "ai-evidence-in-action/demo-evidence/1";
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const MAX_BODY_BYTES = 4096;

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function fail(status, code, message) {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
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
  const length = Number(req.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return fail(413, "PAYLOAD_TOO_LARGE", "Demo request is too large.");

  let body;
  try {
    body = await req.json();
  } catch {
    return fail(400, "MALFORMED_JSON", "Request body must be valid JSON.");
  }

  const rootB64 = Netlify.env.get("AIEIA_SITE_SIGNING_KEY_PKCS8_B64");
  if (!rootB64) return fail(503, "DEMO_SIGNING_UNAVAILABLE", "Demo signing is temporarily unavailable.");

  let claimId;
  let requestId;
  try {
    claimId = safeId(body?.claim_id, "claim_id");
    requestId = safeId(body?.request_id, "request_id");
  } catch (error) {
    return fail(400, "IDENTIFIER_INVALID", error.message);
  }

  if (!body || !["site", "destination"].includes(body.mode)) {
    return fail(400, "MODE_INVALID", "mode must be site or destination.");
  }
  if (body.order_id !== "ORD-1042" || body.amount_cents !== 6400) {
    return fail(400, "DEMO_INPUT_INVALID", "This public demo only supports synthetic order ORD-1042 for $64.00.");
  }

  const origin = new URL(req.url).origin;
  const isSite = body.mode === "site";
  const keyId = isSite ? "site-demo-2026" : "destination-demo-2026";
  const record = {
    schema: SCHEMA,
    record_id: `rec_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    record_type: isSite ? "site_claim" : "destination_report",
    claim_id: claimId,
    request_id: requestId,
    source: { id: isSite ? "site-demo" : "destination-demo", origin },
    statement: isSite ? "SUCCESS_DECLARED" : "ACTION_ABSENT",
    subject: { order_id: "ORD-1042", amount_cents: 6400, currency: "USD" },
    observed_at: new Date().toISOString()
  };

  const signed = signRecord(record, Buffer.from(rootB64, "base64"), keyId);
  return new Response(JSON.stringify({ ok: true, record: signed }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
};

export const config = { path: "/api/demo-record" };
