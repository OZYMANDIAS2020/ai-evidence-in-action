import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyBundle } from "../src/evidence.js";

/**
 * The page and the downloadable verifier must reach the same conclusion about
 * the same bundle. They share no code on purpose — the offline verifier must
 * decide without contacting the site — so equivalence is checked by running
 * both over the published example bundle and every tamper this test can build
 * from it while keeping the real signatures intact.
 */
const keyDocument = JSON.parse(fs.readFileSync("src/.well-known/ai-evidence-in-action-keys.json", "utf8"));
globalThis.fetch = async () => new Response(JSON.stringify(keyDocument), { status: 200, headers: { "content-type": "application/json" } });

const VERIFIER = "src/downloads/verify.mjs";
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aieia-equivalence-"));
const readFixture = (name) => JSON.parse(fs.readFileSync(`src/downloads/${name}`, "utf8"));

function runOffline(bundle, label) {
  const file = path.join(workDir, `${label.replace(/[^a-z0-9]+/gi, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2));
  const result = spawnSync(process.execPath, [VERIFIER, file], { encoding: "utf8" });
  const jsonText = result.stdout.slice(0, result.stdout.indexOf("\n\n"));
  return { exitCode: result.status, report: JSON.parse(jsonText), stdout: result.stdout };
}

/** Every case below keeps the published signatures valid unless it says otherwise. */
const cases = {
  "clean example bundle": (b) => b,
  "verdict only": (b) => { b.comparison.verdict = "AGREEMENT"; return b; },
  "diff.match only": (b) => { for (const row of b.comparison.diff) row.match = true; return b; },
  "diff site_value only": (b) => { b.comparison.diff[1].site_value = "ORD-9999"; return b; },
  "diff destination_value only": (b) => { b.comparison.diff[0].destination_value = "ACTION_PRESENT"; return b; },
  "diff field only": (b) => { b.comparison.diff[0].field = "irrelevant"; return b; },
  "diff basis only": (b) => { b.comparison.diff[0].basis = "identity"; return b; },
  "delete a diff row": (b) => { b.comparison.diff.splice(0, 1); return b; },
  "add a diff row": (b) => { b.comparison.diff.push({ field: "invented", basis: "identity", site_value: "x", destination_value: "x", match: true }); return b; },
  "reorder diff rows": (b) => { b.comparison.diff.reverse(); return b; },
  "alter statement_correspondence": (b) => { b.statement_correspondence = { SUCCESS_DECLARED: { ACTION_ABSENT: true, ACTION_PRESENT: true } }; return b; },
  "delete statement_correspondence": (b) => { delete b.statement_correspondence; return b; },
  "inject a reason": (b) => { b.comparison.reason = "STATEMENT_NOT_COMPARABLE"; return b; },
  "inject a missing list": (b) => { b.comparison.missing = ["site"]; return b; },
  "unexpected comparison key": (b) => { b.comparison.confidence = 0.99; return b; },
  "reformatted comparison": (b) => { b.comparison = { diff: b.comparison.diff, missing: [], reason: null, verdict: b.comparison.verdict }; return b; },
  "record tamper (signature breaks)": () => readFixture("bundle.tampered.json"),
  "verdict tamper fixture": () => readFixture("bundle.verdict-tampered.json"),
  "drop the destination record": (b) => { b.records = b.records.filter((r) => r.record_type !== "destination_report"); return b; }
};

for (const [label, mutate] of Object.entries(cases)) {
  test(`browser and offline verifiers agree: ${label}`, async () => {
    const bundle = mutate(readFixture("bundle.example.json"));
    const offline = runOffline(bundle, label);
    const browser = await verifyBundle(JSON.parse(JSON.stringify(bundle)));

    assert.equal(browser.bundle_status, offline.report.bundle_status, `${label}: bundle_status differs`);
    assert.equal(browser.verdict_matches, offline.report.verdict_matches, `${label}: verdict_matches differs`);
    assert.equal(browser.comparison_matches, offline.report.comparison_matches, `${label}: comparison_matches differs`);
    assert.equal(browser.statement_correspondence_matches, offline.report.statement_correspondence_matches, `${label}: correspondence check differs`);
    assert.equal(browser.claim_pair_bound, offline.report.claim_pair_bound, `${label}: claim_pair_bound differs`);
    assert.deepEqual(browser.mismatched_pairing_fields, offline.report.mismatched_pairing_fields, `${label}: pairing fields differ`);
    assert.equal(browser.recomputed_comparison.verdict, offline.report.recomputed_comparison.verdict, `${label}: recomputed verdict differs`);
    assert.equal(browser.recomputed_comparison_digest, offline.report.recomputed_comparison_digest, `${label}: recomputed digest differs`);
    assert.equal(browser.recorded_comparison_digest, offline.report.recorded_comparison_digest, `${label}: recorded digest differs`);
    // The offline exit code must track the shared conclusion.
    assert.equal(offline.exitCode === 0, browser.bundle_status === "VERIFIED", `${label}: offline exit code disagrees with its own status`);
  });
}

test("only the untampered bundle is accepted by either verifier", async () => {
  const accepted = [];
  for (const [label, mutate] of Object.entries(cases)) {
    const bundle = mutate(readFixture("bundle.example.json"));
    if ((await verifyBundle(bundle)).bundle_status === "VERIFIED") accepted.push(label);
  }
  assert.deepEqual(accepted, ["clean example bundle", "reformatted comparison"]);
});

/**
 * The pairing gate cannot be exercised end to end against the offline verifier
 * without a second validly signed record carrying a different claim_id, which
 * would require the production signing secret. Its behaviour is covered
 * browser-side in bundle-integrity.test.mjs; here the two implementations are
 * pinned to the same rule and the same precedence so they cannot drift.
 */
test("both verifiers declare the same pairing fields and the same status precedence", () => {
  const offlineSource = fs.readFileSync(VERIFIER, "utf8");
  const browserSource = fs.readFileSync("src/evidence.js", "utf8");
  const pairing = /PAIRING_FIELDS = \["claim_id", "request_id", "scenario"\]/;
  assert.match(offlineSource, pairing);
  assert.match(browserSource, pairing);
  for (const source of [offlineSource, browserSource]) {
    assert.match(source, /pairingMismatches\(site, destination\)|pairingMismatches\(verifiedSite, verifiedDestination\)/);
    assert.match(source, /"SIGNATURE_INVALID"[\s\S]{0,120}"CLAIM_PAIR_MISMATCH"[\s\S]{0,160}"VERIFIED"[\s\S]{0,40}"COMPARISON_ALTERED"/);
    assert.match(source, /const \{ verdict = null, reason = null, missing = \[\], diff = \[\], \.\.\.rest \} = comparison;/);
  }
});

test.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
