export const SCHEMA = "ai-evidence-in-action/demo-evidence/1";
export const BUNDLE_SCHEMA = "ai-evidence-in-action/demo-bundle/1";
export const KEYS_URL = "/.well-known/ai-evidence-in-action-keys.json";

/**
 * The two demo sources speak different statement vocabularies: the site declares
 * what it did, the destination reports what it observed. Comparing them needs a
 * declared correspondence relation, not string equality. The table below is the
 * whole relation. It is published in every bundle so an independent verifier can
 * reproduce the verdict, and a statement pair outside it is reported as not
 * comparable rather than silently counted as a disagreement.
 */
export const SITE_STATEMENTS = ["SUCCESS_DECLARED"];
export const DESTINATION_STATEMENTS = ["ACTION_PRESENT", "ACTION_ABSENT"];
export const STATEMENT_CORRESPONDENCE = {
  SUCCESS_DECLARED: { ACTION_PRESENT: true, ACTION_ABSENT: false }
};
export const SUBJECT_FIELDS = ["order_id", "amount_cents", "currency"];
export const COMPARED_FIELDS = ["statement", ...SUBJECT_FIELDS];
export const SCENARIOS = ["disagreement", "agreement", "insufficient_evidence"];
export const DEFAULT_SCENARIO = "disagreement";

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

export function compareRecords(site, destination) {
  if (!site || !destination) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      missing: [!site ? "site" : null, !destination ? "destination" : null].filter(Boolean),
      diff: []
    };
  }
  const correspondence = STATEMENT_CORRESPONDENCE[site.statement]?.[destination.statement];
  const diff = [
    { field: "statement", basis: "declared_correspondence", site_value: site.statement, destination_value: destination.statement, match: correspondence === true },
    ...SUBJECT_FIELDS.map((field) => ({ field, basis: "identity", site_value: site.subject?.[field], destination_value: destination.subject?.[field], match: site.subject?.[field] === destination.subject?.[field] }))
  ];
  if (correspondence === undefined) {
    return { verdict: "INSUFFICIENT_EVIDENCE", diff, reason: "STATEMENT_NOT_COMPARABLE" };
  }
  return { verdict: diff.every((row) => row.match) ? "AGREEMENT" : "DISAGREEMENT", diff };
}

/**
 * Recomputes the comparison from the records that actually verified, then checks
 * that result against the verdict recorded in the bundle. A bundle whose records
 * are untouched but whose verdict has been edited fails here even though every
 * signature is still valid.
 */
export async function verifyBundle(bundle) {
  const serialized = JSON.stringify(bundle);
  if (serialized.length > 262144) return { ok: false, error: { code: "BUNDLE_TOO_LARGE", message: "Evidence bundle exceeds the 256 KB demo limit." } };
  if (!bundle || !Array.isArray(bundle.records)) return { ok: false, error: { code: "RECORD_MALFORMED", message: "Evidence bundle must contain a records array." } };
  const keys = await loadPublicKeys();
  const checks = await Promise.all(bundle.records.map((record) => verifyRecord(record, keys)));
  const allValid = checks.length > 0 && checks.every((check) => check.signature_valid && check.hash_valid);
  const anyInvalid = checks.some((check) => check.status === "SIGNATURE_INVALID" || check.status === "UNKNOWN_KEY");
  const overall = allValid ? "SIGNATURE_VALID" : anyInvalid ? "SIGNATURE_INVALID" : "NOT_SIGNED";

  const isVerified = (index) => checks[index].hash_valid && checks[index].signature_valid;
  const verified = bundle.records.filter((_, index) => isVerified(index));
  const excluded = bundle.records.filter((_, index) => !isVerified(index)).map((record) => record?.record_id || "unknown");
  const recomputed = compareRecords(
    verified.find((record) => record.record_type === "site_claim") || null,
    verified.find((record) => record.record_type === "destination_report") || null
  );
  const recordedVerdict = bundle.comparison?.verdict ?? null;
  const verdictMatches = recordedVerdict !== null && recomputed.verdict === recordedVerdict;

  return {
    ok: true,
    checks,
    overall,
    comparison_source: "recomputed_from_verified_records",
    excluded_unverified_records: excluded,
    recomputed_comparison: recomputed,
    recorded_verdict: recordedVerdict,
    verdict_matches: verdictMatches,
    bundle_status: !allValid ? "SIGNATURE_INVALID" : verdictMatches ? "VERIFIED" : "COMPARISON_ALTERED"
  };
}

export function makeBundle(site, destination, comparison) {
  return {
    schema: BUNDLE_SCHEMA,
    created_at: nowIso(),
    records: [site, destination].filter(Boolean),
    comparison,
    statement_correspondence: STATEMENT_CORRESPONDENCE,
    limitations: [
      "Synthetic demonstration data only.",
      "The destination source is simulated in the same demo deployment by the same operator.",
      "Valid signatures establish demo-record integrity and attribution to the published demo keys only.",
      "The demo does not prove any real-world financial event occurred.",
      "The demo does not establish that the two sources are organizationally independent."
    ]
  };
}
