import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { compareRecords, makeBundle, verifyBundle } from "../src/evidence.js";

/**
 * Exercises the same verifyBundle the page calls, against records signed with
 * throwaway Ed25519 keys. The published key document is stubbed once because
 * loadPublicKeys caches it, so every record here is signed with these keys.
 */
const keyPairs = {
  "site-demo-2026": generateKeyPairSync("ed25519"),
  "destination-demo-2026": generateKeyPairSync("ed25519")
};

const keyDocument = {
  schema: "ai-evidence-in-action/demo-keys/1",
  keys: Object.fromEntries(Object.entries(keyPairs).map(([keyId, pair]) => [
    keyId,
    { algorithm: "Ed25519", spki_base64: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64") }
  ]))
};

globalThis.fetch = async () => new Response(JSON.stringify(keyDocument), { status: 200, headers: { "content-type": "application/json" } });

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function signRecord(payload, keyId) {
  const digest = createHash("sha256").update(canonicalize(payload)).digest();
  return {
    ...payload,
    integrity: {
      status: "SIGNED",
      algorithm: "Ed25519",
      digest: "SHA-256",
      payload_sha256: digest.toString("hex"),
      sig_ed25519: sign(null, digest, keyPairs[keyId].privateKey).toString("base64"),
      key_id: keyId
    }
  };
}

const subject = { order_id: "ORD-1042", amount_cents: 6400, currency: "USD" };

function siteRecord(scenario = "disagreement") {
  return signRecord({
    schema: "ai-evidence-in-action/demo-evidence/1",
    record_id: "rec_test_site",
    record_type: "site_claim",
    claim_id: "clm_test",
    request_id: "req_test",
    scenario,
    source: { id: "site-demo", origin: "https://example.invalid" },
    statement: "SUCCESS_DECLARED",
    subject,
    observed_at: "2026-08-30T04:00:00.000Z"
  }, "site-demo-2026");
}

function destinationRecord(statement, scenario = "disagreement") {
  return signRecord({
    schema: "ai-evidence-in-action/demo-evidence/1",
    record_id: "rec_test_destination",
    record_type: "destination_report",
    claim_id: "clm_test",
    request_id: "req_test",
    scenario,
    source: { id: "destination-demo", origin: "https://example.invalid" },
    statement,
    subject,
    observed_at: "2026-08-30T04:00:01.000Z"
  }, "destination-demo-2026");
}

function bundleFor(destinationStatement, scenario = "disagreement") {
  const site = siteRecord(scenario);
  const destination = destinationStatement ? destinationRecord(destinationStatement, scenario) : null;
  return makeBundle(site, destination, compareRecords(site, destination));
}

test("a well-formed disagreement bundle verifies and its verdict is reproduced", async () => {
  const result = await verifyBundle(bundleFor("ACTION_ABSENT"));
  assert.equal(result.ok, true);
  assert.equal(result.overall, "SIGNATURE_VALID");
  assert.equal(result.recorded_verdict, "DISAGREEMENT");
  assert.equal(result.recomputed_comparison.verdict, "DISAGREEMENT");
  assert.equal(result.verdict_matches, true);
  assert.equal(result.bundle_status, "VERIFIED");
});

test("a well-formed agreement bundle verifies and its verdict is reproduced", async () => {
  const result = await verifyBundle(bundleFor("ACTION_PRESENT", "agreement"));
  assert.equal(result.recorded_verdict, "AGREEMENT");
  assert.equal(result.recomputed_comparison.verdict, "AGREEMENT");
  assert.equal(result.verdict_matches, true);
  assert.equal(result.bundle_status, "VERIFIED");
});

test("a bundle with no destination record reproduces INSUFFICIENT_EVIDENCE", async () => {
  const result = await verifyBundle(bundleFor(null, "insufficient_evidence"));
  assert.equal(result.recorded_verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.recomputed_comparison.verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.verdict_matches, true);
  assert.equal(result.bundle_status, "VERIFIED");
});

test("editing only the recorded verdict is detected while every signature still passes", async () => {
  const bundle = bundleFor("ACTION_ABSENT");
  bundle.comparison.verdict = "AGREEMENT";
  const result = await verifyBundle(bundle);
  assert.equal(result.overall, "SIGNATURE_VALID", "signatures are untouched by a verdict edit");
  assert.equal(result.checks.every((check) => check.signature_valid), true);
  assert.equal(result.recomputed_comparison.verdict, "DISAGREEMENT");
  assert.equal(result.recorded_verdict, "AGREEMENT");
  assert.equal(result.verdict_matches, false);
  assert.equal(result.bundle_status, "COMPARISON_ALTERED");
});

test("editing only the recorded diff rows still leaves the verdict reproducible", async () => {
  const bundle = bundleFor("ACTION_ABSENT");
  for (const row of bundle.comparison.diff) row.match = true;
  const result = await verifyBundle(bundle);
  // The verdict is recomputed from the records, never read back from the diff.
  assert.equal(result.recomputed_comparison.verdict, "DISAGREEMENT");
  assert.equal(result.recomputed_comparison.diff.find((row) => row.field === "statement").match, false);
  assert.equal(result.verdict_matches, true);
});

test("a removed verdict does not silently pass", async () => {
  const bundle = bundleFor("ACTION_ABSENT");
  delete bundle.comparison;
  const result = await verifyBundle(bundle);
  assert.equal(result.recorded_verdict, null);
  assert.equal(result.verdict_matches, false);
  assert.equal(result.bundle_status, "COMPARISON_ALTERED");
});

test("an altered record fails its signature and is excluded from the recomputation", async () => {
  const bundle = bundleFor("ACTION_ABSENT");
  bundle.records[1].statement = "ACTION_PRESENT";
  const result = await verifyBundle(bundle);
  assert.equal(result.overall, "SIGNATURE_INVALID");
  assert.equal(result.checks[1].hash_valid, false);
  assert.equal(result.checks[1].signature_valid, false);
  assert.deepEqual(result.excluded_unverified_records, ["rec_test_destination"]);
  // Swapping the statement must not buy an AGREEMENT: the record no longer counts.
  assert.equal(result.recomputed_comparison.verdict, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.bundle_status, "SIGNATURE_INVALID");
});

test("a record signed by an unpublished key is rejected", async () => {
  const bundle = bundleFor("ACTION_ABSENT");
  bundle.records[1].integrity.key_id = "some-other-key-2026";
  const result = await verifyBundle(bundle);
  assert.equal(result.checks[1].status, "UNKNOWN_KEY");
  assert.equal(result.overall, "SIGNATURE_INVALID");
});

test("an unsigned record is reported as unsigned rather than valid", async () => {
  const bundle = bundleFor("ACTION_ABSENT");
  delete bundle.records[1].integrity;
  const result = await verifyBundle(bundle);
  assert.equal(result.checks[1].status, "NOT_SIGNED");
  assert.equal(result.overall, "NOT_SIGNED");
  assert.equal(result.bundle_status, "SIGNATURE_INVALID");
});

test("a malformed bundle is refused", async () => {
  const result = await verifyBundle({ schema: "ai-evidence-in-action/demo-bundle/1" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RECORD_MALFORMED");
});

test("an oversized bundle is refused", async () => {
  const bundle = bundleFor("ACTION_ABSENT");
  bundle.padding = "A".repeat(300000);
  const result = await verifyBundle(bundle);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "BUNDLE_TOO_LARGE");
});

test("the bundle publishes the correspondence table a verifier needs", async () => {
  const bundle = bundleFor("ACTION_ABSENT");
  assert.deepEqual(bundle.statement_correspondence, { SUCCESS_DECLARED: { ACTION_PRESENT: true, ACTION_ABSENT: false } });
});
