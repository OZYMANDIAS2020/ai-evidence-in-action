export const SCHEMA = "ai-evidence-in-action/demo-evidence/1";
export const BUNDLE_SCHEMA = "ai-evidence-in-action/demo-bundle/1";
export const KEYS_URL = "/.well-known/ai-evidence-in-action-keys.json";

export function randomId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function nowIso() { return new Date().toISOString(); }

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function payloadForRecord(record) { const { integrity, ...payload } = record; return payload; }
function bytesToHex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function base64ToBytes(value) { const raw = atob(value); return Uint8Array.from(raw, (char) => char.charCodeAt(0)); }

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

let cachedKeys;
export async function loadPublicKeys() {
  if (!cachedKeys) cachedKeys = fetch(KEYS_URL, { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error(`Public demo keys unavailable (${response.status}).`); return response.json(); });
  return cachedKeys;
}

export async function verifyRecord(record, keyDocument) {
  if (!record?.integrity || record.integrity.status !== "SIGNED") return { record_id: record?.record_id || "unknown", hash_valid: false, signature_valid: false, key_id: null, status: "NOT_SIGNED" };
  const payloadHash = await sha256Hex(canonicalize(payloadForRecord(record)));
  const hashValid = payloadHash === record.integrity.payload_sha256;
  const keySpec = keyDocument?.keys?.[record.integrity.key_id];
  if (!keySpec) return { record_id: record.record_id, hash_valid: hashValid, signature_valid: false, key_id: record.integrity.key_id, status: "UNKNOWN_KEY" };
  try {
    const publicKey = await crypto.subtle.importKey("spki", base64ToBytes(keySpec.spki_base64), { name: "Ed25519" }, false, ["verify"]);
    const digestBytes = Uint8Array.from(payloadHash.match(/.{2}/g).map((byte) => parseInt(byte, 16)));
    const signatureValid = hashValid && await crypto.subtle.verify({ name: "Ed25519" }, publicKey, base64ToBytes(record.integrity.sig_ed25519), digestBytes);
    return { record_id: record.record_id, hash_valid: hashValid, signature_valid: signatureValid, key_id: record.integrity.key_id, status: signatureValid ? "SIGNATURE_VALID" : "SIGNATURE_INVALID" };
  } catch (error) {
    return { record_id: record.record_id, hash_valid: hashValid, signature_valid: false, key_id: record.integrity.key_id, status: "SIGNATURE_INVALID", error: error?.message || String(error) };
  }
}

export async function verifyBundle(bundle) {
  const serialized = JSON.stringify(bundle);
  if (serialized.length > 262144) return { ok: false, error: { code: "BUNDLE_TOO_LARGE", message: "Evidence bundle exceeds the 256 KB demo limit." } };
  if (!bundle || !Array.isArray(bundle.records)) return { ok: false, error: { code: "RECORD_MALFORMED", message: "Evidence bundle must contain a records array." } };
  const keys = await loadPublicKeys();
  const checks = await Promise.all(bundle.records.map((record) => verifyRecord(record, keys)));
  const allValid = checks.length > 0 && checks.every((check) => check.signature_valid && check.hash_valid);
  const anyInvalid = checks.some((check) => check.status === "SIGNATURE_INVALID" || check.status === "UNKNOWN_KEY");
  return { ok: true, checks, overall: allValid ? "SIGNATURE_VALID" : anyInvalid ? "SIGNATURE_INVALID" : "NOT_SIGNED" };
}

export function compareRecords(site, destination) {
  if (!site || !destination) return { verdict: "INSUFFICIENT_EVIDENCE", missing: [!site ? "site" : null, !destination ? "destination" : null].filter(Boolean), diff: [] };
  const fields = ["order_id", "amount_cents", "currency"];
  const diff = fields.map((field) => ({ field, site_value: site.subject[field], destination_value: destination.subject[field], match: site.subject[field] === destination.subject[field] }));
  const actionPresent = destination.statement === "ACTION_PRESENT";
  const allMatch = diff.every((row) => row.match);
  return { verdict: actionPresent && allMatch ? "AGREEMENT" : "DISAGREEMENT", diff };
}

export function makeBundle(site, destination, comparison) {
  return {
    schema: BUNDLE_SCHEMA,
    created_at: nowIso(),
    records: [site, destination].filter(Boolean),
    comparison,
    limitations: [
      "Synthetic demonstration data only.",
      "The destination source is simulated in the same demo deployment.",
      "Valid signatures establish demo-record integrity and attribution to the published demo keys only.",
      "The demo does not prove any real-world financial event occurred.",
      "The demo does not establish that the two sources are organizationally independent."
    ]
  };
}
