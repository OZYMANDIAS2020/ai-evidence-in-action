import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalComparison, compareRecords, makeBundle, PAIRING_FIELDS, pairingMismatches, verifyBundle } from "../src/evidence.js";

/**
 * Two properties are pinned here, both of which a valid set of signatures does
 * not by itself establish:
 *
 *   1. the two records are evidence about the same request, so validly signed
 *      records from different claims cannot be spliced into a verified pair;
 *   2. the whole recorded comparison reproduces from those records, not just
 *      the verdict.
 */
const keyPairs = {
  "site-demo-2026": generateKeyPairSync("ed25519"),
  "destination-demo-2026": generateKeyPairSync("ed25519")
};
const keyDocument = {
  schema: "ai-evidence-in-action/demo-keys/1",
  keys: Object.fromEntries(Object.entries(keyPairs).map(([keyId, pair]) => [keyId, { algorithm: "Ed25519", spki_base64: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64") }]))
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
    integrity: { status: "SIGNED", algorithm: "Ed25519", digest: "SHA-256", payload_sha256: digest.toString("hex"), sig_ed25519: sign(null, digest, keyPairs[keyId].privateKey).toString("base64"), key_id: keyId }
  };
}

const subject = { order_id: "ORD-1042", amount_cents: 6400, currency: "USD" };
const siteRecord = ({ claim = "clm_X", request = "req_X", scenario = "disagreement" } = {}) => signRecord({
  schema: "ai-evidence-in-action/demo-evidence/1", record_id: `rec_site_${claim}`, record_type: "site_claim",
  claim_id: claim, request_id: request, scenario, source: { id: "site-demo", origin: "https://example.invalid" },
  statement: "SUCCESS_DECLARED", subject, observed_at: "2026-08-30T04:00:00.000Z"
}, "site-demo-2026");
const destinationRecord = ({ claim = "clm_X", request = "req_X", scenario = "disagreement", statement = "ACTION_ABSENT" } = {}) => signRecord({
  schema: "ai-evidence-in-action/demo-evidence/1", record_id: `rec_dest_${claim}`, record_type: "destination_report",
  claim_id: claim, request_id: request, scenario, source: { id: "destination-demo", origin: "https://example.invalid" },
  statement, subject, observed_at: "2026-08-30T04:00:01.000Z"
}, "destination-demo-2026");

const bundleFrom = (site, destination) => JSON.parse(JSON.stringify(makeBundle(site, destination, compareRecords(site, destination))));
const clean = () => bundleFrom(siteRecord(), destinationRecord());

const allSignaturesValid = (result) => result.checks.length > 0 && result.checks.every((check) => check.signature_valid && check.hash_valid);

test("an untampered bundle verifies", async () => {
  const result = await verifyBundle(clean());
  assert.equal(result.bundle_status, "VERIFIED");
  assert.equal(result.claim_pair_bound, true);
  assert.equal(result.comparison_matches, true);
  assert.equal(result.statement_correspondence_matches, true);
  assert.equal(result.recorded_comparison_digest, result.recomputed_comparison_digest);
});

// ---------------------------------------------------------------- pairing

test("the pairing fields are the signed ones that bind a pair", () => {
  assert.deepEqual(PAIRING_FIELDS, ["claim_id", "request_id", "scenario"]);
  // Each must be inside the signed payload, i.e. present on the record itself.
  const record = siteRecord();
  for (const field of PAIRING_FIELDS) assert.ok(Object.hasOwn(record, field), `${field} is not part of the signed record`);
});

test("splice A: validly signed records from different claims are not a verified pair", async () => {
  const site = siteRecord({ claim: "clm_A", request: "req_A" });
  const destination = destinationRecord({ claim: "clm_B", request: "req_B" });
  const result = await verifyBundle(bundleFrom(site, destination));
  assert.equal(allSignaturesValid(result), true, "both signatures must still be valid for this test to mean anything");
  assert.equal(result.overall, "SIGNATURE_VALID");
  assert.equal(result.bundle_status, "CLAIM_PAIR_MISMATCH");
  assert.notEqual(result.bundle_status, "VERIFIED");
  assert.equal(result.claim_pair_bound, false);
  assert.deepEqual(result.mismatched_pairing_fields, ["claim_id", "request_id"]);
});

test("splice B: a disagreement site record with an agreement destination record is refused", async () => {
  const site = siteRecord({ claim: "clm_A", request: "req_A", scenario: "disagreement" });
  const destination = destinationRecord({ claim: "clm_B", request: "req_B", scenario: "agreement", statement: "ACTION_PRESENT" });
  const result = await verifyBundle(bundleFrom(site, destination));
  assert.equal(allSignaturesValid(result), true);
  assert.equal(result.bundle_status, "CLAIM_PAIR_MISMATCH");
  assert.deepEqual(result.mismatched_pairing_fields, ["claim_id", "request_id", "scenario"]);
});

test("a mismatch in any single pairing field is enough to refuse the pair", async () => {
  for (const [field, destination] of [
    ["claim_id", destinationRecord({ claim: "clm_OTHER" })],
    ["request_id", destinationRecord({ request: "req_OTHER" })],
    ["scenario", destinationRecord({ scenario: "agreement" })]
  ]) {
    const result = await verifyBundle(bundleFrom(siteRecord(), destination));
    assert.equal(result.bundle_status, "CLAIM_PAIR_MISMATCH", `${field} mismatch was not refused`);
    assert.deepEqual(result.mismatched_pairing_fields, [field]);
  }
});

test("an honestly recorded splice is still refused, so the pairing gate is not bypassable", async () => {
  // The attacker records exactly what compareRecords returns for the spliced
  // pair, so the comparison itself reproduces. The pair must still be refused.
  const site = siteRecord({ claim: "clm_A", request: "req_A" });
  const destination = destinationRecord({ claim: "clm_B", request: "req_B" });
  const bundle = bundleFrom(site, destination);
  const result = await verifyBundle(bundle);
  assert.equal(result.comparison_matches, true, "the recorded comparison does reproduce");
  assert.equal(result.bundle_status, "CLAIM_PAIR_MISMATCH", "yet the pair is still refused");
});

test("records that are absent or legacy-shaped do not create a false mismatch", () => {
  assert.deepEqual(pairingMismatches(null, destinationRecord()), []);
  assert.deepEqual(pairingMismatches(siteRecord(), null), []);
  // Records predating the scenario field: absent on both sides is still a match.
  const legacySite = { claim_id: "c", request_id: "r" };
  const legacyDestination = { claim_id: "c", request_id: "r" };
  assert.deepEqual(pairingMismatches(legacySite, legacyDestination), []);
  assert.deepEqual(pairingMismatches(legacySite, { claim_id: "c", request_id: "r", scenario: "agreement" }), ["scenario"]);
});

// --------------------------------------------------- full comparison equality

const mutations = {
  "verdict only": (b) => { b.comparison.verdict = "AGREEMENT"; },
  "diff.match only": (b) => { for (const row of b.comparison.diff) row.match = true; },
  "diff site_value only": (b) => { b.comparison.diff[1].site_value = "ORD-9999"; },
  "diff destination_value only": (b) => { b.comparison.diff[0].destination_value = "ACTION_PRESENT"; },
  "diff field only": (b) => { b.comparison.diff[0].field = "irrelevant"; },
  "diff basis only": (b) => { b.comparison.diff[0].basis = "identity"; },
  "delete a required diff row": (b) => { b.comparison.diff.splice(0, 1); },
  "add an unexpected diff row": (b) => { b.comparison.diff.push({ field: "invented", basis: "identity", site_value: "x", destination_value: "x", match: true }); },
  "reorder diff rows": (b) => { b.comparison.diff.reverse(); },
  "alter statement_correspondence": (b) => { b.statement_correspondence = { SUCCESS_DECLARED: { ACTION_ABSENT: true, ACTION_PRESENT: true } }; },
  "delete statement_correspondence": (b) => { delete b.statement_correspondence; },
  "inject a reason": (b) => { b.comparison.reason = "STATEMENT_NOT_COMPARABLE"; },
  "inject a missing list": (b) => { b.comparison.missing = ["site"]; },
  "add an unexpected comparison key": (b) => { b.comparison.confidence = 0.99; },
  "replace the comparison with a bare verdict": (b) => { b.comparison = { verdict: "DISAGREEMENT" }; }
};

for (const [label, mutate] of Object.entries(mutations)) {
  test(`recorded comparison tamper is detected: ${label}`, async () => {
    const bundle = clean();
    mutate(bundle);
    const result = await verifyBundle(bundle);
    assert.equal(allSignaturesValid(result), true, "the signed records must be untouched for this test to mean anything");
    assert.equal(result.overall, "SIGNATURE_VALID");
    assert.equal(result.bundle_status, "COMPARISON_ALTERED", `${label} was accepted`);
    assert.notEqual(result.bundle_status, "VERIFIED");
  });
}

test("a comparison that is merely reformatted still verifies", async () => {
  // Key order and explicitly-absent optional fields are not semantic.
  const bundle = clean();
  bundle.comparison = { diff: bundle.comparison.diff.map((row) => ({ match: row.match, basis: row.basis, destination_value: row.destination_value, site_value: row.site_value, field: row.field })), verdict: bundle.comparison.verdict, missing: [], reason: null };
  const result = await verifyBundle(bundle);
  assert.equal(result.bundle_status, "VERIFIED");
});

test("the canonical comparison is one deterministic string", () => {
  const comparison = compareRecords(siteRecord(), destinationRecord());
  assert.equal(canonicalComparison(comparison), canonicalComparison(JSON.parse(JSON.stringify(comparison))));
  assert.notEqual(canonicalComparison(comparison), canonicalComparison({ ...comparison, verdict: "AGREEMENT" }));
  for (const notAnObject of [null, undefined, "x", 3, []]) assert.equal(canonicalComparison(notAnObject), null);
});

test("the recorded digest is computed from content, never taken from the bundle", async () => {
  const bundle = clean();
  bundle.comparison_digest = "0".repeat(64);
  bundle.recorded_comparison_digest = "0".repeat(64);
  const result = await verifyBundle(bundle);
  assert.notEqual(result.recorded_comparison_digest, "0".repeat(64));
  // A supplied digest is just another unexpected key: it does not authenticate.
  assert.equal(result.bundle_status, "VERIFIED");
  assert.equal(result.recorded_comparison_digest, result.recomputed_comparison_digest);
});

test("an insufficient-evidence bundle records only what a verifier can reproduce", async () => {
  const site = siteRecord({ scenario: "insufficient_evidence" });
  const bundle = bundleFrom(site, null);
  assert.equal(bundle.comparison.reason, undefined, "a non-reproducible reason must not be recorded");
  const result = await verifyBundle(bundle);
  assert.equal(result.bundle_status, "VERIFIED");
  assert.equal(result.recomputed_comparison.verdict, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(result.recomputed_comparison.missing, ["destination"]);
});
