#!/usr/bin/env node
import fs from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";

const PUBLIC_KEYS = {
  "site-demo-2026": "MCowBQYDK2VwAyEATq/vzvMcOiKJDoHWTf+crCgpfmJJK3xkqNiJj47/YCQ=",
  "destination-demo-2026": "MCowBQYDK2VwAyEAUG8cNiPTPddXq6gOOfCcQQ8dZjRbniLZmtDVU+5BNyY="
};

// The same declared correspondence relation the page uses. It is duplicated here
// on purpose: this script must reach its verdict without contacting the site.
const STATEMENT_CORRESPONDENCE = {
  SUCCESS_DECLARED: { ACTION_PRESENT: true, ACTION_ABSENT: false }
};
const SUBJECT_FIELDS = ["order_id", "amount_cents", "currency"];

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function payloadForRecord(record) {
  const { integrity, ...payload } = record;
  return payload;
}

function compareRecords(site, destination) {
  if (!site || !destination) {
    return { verdict: "INSUFFICIENT_EVIDENCE", missing: [!site ? "site" : null, !destination ? "destination" : null].filter(Boolean), diff: [] };
  }
  const correspondence = STATEMENT_CORRESPONDENCE[site.statement]?.[destination.statement];
  const diff = [
    { field: "statement", basis: "declared_correspondence", site_value: site.statement, destination_value: destination.statement, match: correspondence === true },
    ...SUBJECT_FIELDS.map((field) => ({ field, basis: "identity", site_value: site.subject?.[field], destination_value: destination.subject?.[field], match: site.subject?.[field] === destination.subject?.[field] }))
  ];
  if (correspondence === undefined) return { verdict: "INSUFFICIENT_EVIDENCE", diff, reason: "STATEMENT_NOT_COMPARABLE" };
  return { verdict: diff.every((row) => row.match) ? "AGREEMENT" : "DISAGREEMENT", diff };
}

function verifyRecord(record) {
  if (!record?.integrity || record.integrity.status !== "SIGNED") return { record_id: record?.record_id || "unknown", hash_valid: false, signature_valid: false, status: "NOT_SIGNED" };
  const publicKeyB64 = PUBLIC_KEYS[record.integrity.key_id];
  if (!publicKeyB64) return { record_id: record.record_id, hash_valid: false, signature_valid: false, status: "UNKNOWN_KEY", key_id: record.integrity.key_id };
  const digest = createHash("sha256").update(canonicalize(payloadForRecord(record))).digest();
  const hashValid = digest.toString("hex") === record.integrity.payload_sha256;
  const publicKey = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
  let signatureValid = false;
  try {
    signatureValid = hashValid && verify(null, digest, publicKey, Buffer.from(record.integrity.sig_ed25519 || "", "base64"));
  } catch {
    signatureValid = false;
  }
  return { record_id: record.record_id, hash_valid: hashValid, signature_valid: signatureValid, status: signatureValid ? "SIGNATURE_VALID" : "SIGNATURE_INVALID", key_id: record.integrity.key_id };
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node verify.mjs <bundle.json>"); process.exit(3); }
  let bundle;
  try { bundle = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { console.error(`Could not read bundle: ${error.message}`); process.exit(3); }
  if (!bundle || !Array.isArray(bundle.records)) { console.error("Malformed bundle: records array is required."); process.exit(3); }

  const checks = bundle.records.map(verifyRecord);
  // Only records that actually verified are allowed to feed the recomputation.
  const isVerified = (index) => checks[index].hash_valid && checks[index].signature_valid;
  const verified = bundle.records.filter((_, index) => isVerified(index));
  const excluded = bundle.records.filter((_, index) => !isVerified(index)).map((record) => record?.record_id || "unknown");
  const site = verified.find((record) => record.record_type === "site_claim") || null;
  const destination = verified.find((record) => record.record_type === "destination_report") || null;
  const recomputed = compareRecords(site, destination);
  const recordedVerdict = bundle.comparison?.verdict ?? null;
  const verdictMatches = recordedVerdict !== null && recomputed.verdict === recordedVerdict;
  const signaturesValid = checks.length > 0 && checks.every((check) => check.signature_valid && check.hash_valid);
  const bundleStatus = !signaturesValid ? "SIGNATURE_INVALID" : verdictMatches ? "VERIFIED" : "COMPARISON_ALTERED";

  console.log(JSON.stringify({
    checks,
    comparison_source: "recomputed_from_verified_records",
    excluded_unverified_records: excluded,
    recomputed_comparison: recomputed,
    recorded_verdict: recordedVerdict,
    verdict_matches: verdictMatches,
    bundle_status: bundleStatus
  }, null, 2));
  console.log();
  console.log(`VERIFIED: each record's canonical hash matches payload_sha256: ${checks.every((c) => c.hash_valid) ? "YES" : "NO"}`);
  console.log(`VERIFIED: each signature is valid for its published demo key: ${signaturesValid ? "YES" : "NO"}`);
  console.log(`VERIFIED: recomputed comparison verdict matches the bundle: ${verdictMatches ? "YES" : "NO"}`);
  console.log(`BUNDLE STATUS: ${bundleStatus}`);
  console.log("NOT VERIFIED: that any real-world event occurred");
  console.log("NOT VERIFIED: that the demo sources are organizationally independent");
  console.log("NOT VERIFIED: wall-clock accuracy or real-world identity");
  process.exit(signaturesValid && verdictMatches ? 0 : 2);
}

main();
