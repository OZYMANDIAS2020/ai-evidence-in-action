#!/usr/bin/env node
import fs from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";

const PUBLIC_KEYS = {
  "site-demo-2026": "MCowBQYDK2VwAyEATq/vzvMcOiKJDoHWTf+crCgpfmJJK3xkqNiJj47/YCQ=",
  "destination-demo-2026": "MCowBQYDK2VwAyEAUG8cNiPTPddXq6gOOfCcQQ8dZjRbniLZmtDVU+5BNyY="
};

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
  if (!site || !destination) return { verdict: "INSUFFICIENT_EVIDENCE", diff: [] };
  const fields = ["order_id", "amount_cents", "currency"];
  const diff = fields.map((field) => ({ field, site_value: site.subject?.[field], destination_value: destination.subject?.[field], match: site.subject?.[field] === destination.subject?.[field] }));
  const actionPresent = destination.statement === "ACTION_PRESENT";
  return { verdict: actionPresent && diff.every((row) => row.match) ? "AGREEMENT" : "DISAGREEMENT", diff };
}

function verifyRecord(record) {
  if (!record?.integrity || record.integrity.status !== "SIGNED") return { record_id: record?.record_id || "unknown", hash_valid: false, signature_valid: false, status: "NOT_SIGNED" };
  const publicKeyB64 = PUBLIC_KEYS[record.integrity.key_id];
  if (!publicKeyB64) return { record_id: record.record_id, hash_valid: false, signature_valid: false, status: "UNKNOWN_KEY", key_id: record.integrity.key_id };
  const digest = createHash("sha256").update(canonicalize(payloadForRecord(record))).digest();
  const hashValid = digest.toString("hex") === record.integrity.payload_sha256;
  const publicKey = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
  const signatureValid = hashValid && verify(null, digest, publicKey, Buffer.from(record.integrity.sig_ed25519, "base64"));
  return { record_id: record.record_id, hash_valid: hashValid, signature_valid: signatureValid, status: signatureValid ? "SIGNATURE_VALID" : "SIGNATURE_INVALID", key_id: record.integrity.key_id };
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node verify.mjs <bundle.json>"); process.exit(3); }
  let bundle;
  try { bundle = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { console.error(`Could not read bundle: ${error.message}`); process.exit(3); }
  if (!bundle || !Array.isArray(bundle.records)) { console.error("Malformed bundle: records array is required."); process.exit(3); }

  const checks = bundle.records.map(verifyRecord);
  const site = bundle.records.find((record) => record.record_type === "site_claim");
  const destination = bundle.records.find((record) => record.record_type === "destination_report");
  const recomputed = compareRecords(site, destination);
  const verdictMatches = recomputed.verdict === bundle.comparison?.verdict;
  const signaturesValid = checks.length > 0 && checks.every((check) => check.signature_valid && check.hash_valid);

  console.log(JSON.stringify({ checks, recomputed_verdict: recomputed.verdict, recorded_verdict: bundle.comparison?.verdict || null, verdict_matches: verdictMatches }, null, 2));
  console.log();
  console.log(`VERIFIED: each record's canonical hash matches payload_sha256: ${checks.every((c) => c.hash_valid) ? "YES" : "NO"}`);
  console.log(`VERIFIED: each signature is valid for its published demo key: ${signaturesValid ? "YES" : "NO"}`);
  console.log(`VERIFIED: recomputed comparison verdict matches the bundle: ${verdictMatches ? "YES" : "NO"}`);
  console.log("NOT VERIFIED: that any real-world event occurred");
  console.log("NOT VERIFIED: that the demo sources are organizationally independent");
  console.log("NOT VERIFIED: wall-clock accuracy or real-world identity");
  process.exit(signaturesValid && verdictMatches ? 0 : 2);
}

main();
