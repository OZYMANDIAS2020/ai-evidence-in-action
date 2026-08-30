import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalize, compareRecords, makeBundle, verifyBundle } from "../src/evidence.js";
import { alterRecordedComparison, runTamperDemo } from "../src/tamper-demo.js";

const keyPairs = { "site-demo-2026": generateKeyPairSync("ed25519"), "destination-demo-2026": generateKeyPairSync("ed25519") };
const keyDocument = {
  schema: "ai-evidence-in-action/demo-keys/1",
  keys: Object.fromEntries(Object.entries(keyPairs).map(([id, pair]) => [id, { algorithm: "Ed25519", spki_base64: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64") }]))
};
globalThis.fetch = async () => new Response(JSON.stringify(keyDocument), { status: 200, headers: { "content-type": "application/json" } });

function signRecord(payload, keyId) {
  const digest = createHash("sha256").update(canonicalize(payload)).digest();
  return { ...payload, integrity: { status: "SIGNED", algorithm: "Ed25519", digest: "SHA-256", payload_sha256: digest.toString("hex"), sig_ed25519: sign(null, digest, keyPairs[keyId].privateKey).toString("base64"), key_id: keyId } };
}
const subject = { order_id: "ORD-1042", amount_cents: 6400, currency: "USD" };
const siteRecord = (scenario = "disagreement") => signRecord({ schema: "ai-evidence-in-action/demo-evidence/1", record_id: "rec_site", record_type: "site_claim", claim_id: "clm_1", request_id: "req_1", scenario, source: { id: "site-demo", origin: "https://example.invalid" }, statement: "SUCCESS_DECLARED", subject, observed_at: "2026-08-30T04:00:00.000Z" }, "site-demo-2026");
const destinationRecord = (statement = "ACTION_ABSENT", scenario = "disagreement") => signRecord({ schema: "ai-evidence-in-action/demo-evidence/1", record_id: "rec_dest", record_type: "destination_report", claim_id: "clm_1", request_id: "req_1", scenario, source: { id: "destination-demo", origin: "https://example.invalid" }, statement, subject, observed_at: "2026-08-30T04:00:01.000Z" }, "destination-demo-2026");
const bundleFor = (destination, scenario) => { const s = siteRecord(scenario); return JSON.parse(JSON.stringify(makeBundle(s, destination, compareRecords(s, destination)))); };

// ------------------------------------------------------------------ A. favicon
test("the favicon is a local asset the page actually references", () => {
  assert.ok(fs.existsSync("src/favicon.svg"), "src/favicon.svg is missing");
  const html = fs.readFileSync("src/index.html", "utf8");
  assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" \/>/);
  const svg = fs.readFileSync("src/favicon.svg", "utf8");
  assert.match(svg, /^<svg[^>]*viewBox="0 0 32 32"/m);
  // No external fetch of any kind: the CSP forbids it and a judge should not need one.
  assert.equal(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(svg), false, "favicon references an external origin");
  assert.equal(/<script|<image|xlink:href/.test(svg), false, "favicon contains active or external content");
});

// ------------------------------------------------- B. cannot run without evidence
test("the tamper test refuses to run before there is any evidence", async () => {
  for (const empty of [null, undefined, {}, { records: [] }]) {
    const report = await runTamperDemo(empty);
    assert.equal(report.ok, false);
    assert.equal(report.error.code, "NO_EVIDENCE");
  }
  const html = fs.readFileSync("src/index.html", "utf8");
  const app = fs.readFileSync("src/app.js", "utf8");
  assert.match(html, /id="tamper-demo"/);
  // The page also guards before calling, so the button cannot act on empty state.
  assert.match(app, /\$\("tamper-demo"\)\.addEventListener[\s\S]{0,200}if \(!store\.state\.site\)/);
});

// ------------------------------------------------------ C/D. clone, records intact
test("the tamper test works on a clone and never touches the signed records", async () => {
  const bundle = bundleFor(destinationRecord());
  const before = JSON.stringify(bundle);
  const { altered, change } = alterRecordedComparison(bundle);

  assert.notEqual(altered, bundle, "the copy must not be the same object");
  assert.equal(JSON.stringify(bundle), before, "the source bundle was mutated");
  assert.equal(canonicalize(altered.records), canonicalize(bundle.records), "the signed records differ");
  assert.deepEqual(altered.records, bundle.records);
  assert.equal(change.path, "comparison.diff[0].match");
  assert.equal(change.from, false);
  assert.equal(change.to, true);
});

test("only one comparison value changes, and nothing outside the comparison", async () => {
  const bundle = bundleFor(destinationRecord());
  const { altered } = alterRecordedComparison(bundle);
  const differing = Object.keys(bundle).filter((key) => canonicalize(bundle[key]) !== canonicalize(altered[key]));
  assert.deepEqual(differing, ["comparison"], "something outside the comparison changed");
  const changedRows = bundle.comparison.diff.filter((row, index) => canonicalize(row) !== canonicalize(altered.comparison.diff[index]));
  assert.equal(changedRows.length, 1, "more than one diff row changed");
  assert.equal(altered.comparison.verdict, bundle.comparison.verdict, "the verdict was also edited");
});

// ------------------------------ E/F. real verifier result, original still verified
test("the edited copy is rejected by the real verifier while every signature still passes", async () => {
  const bundle = bundleFor(destinationRecord());
  const report = await runTamperDemo(bundle);
  assert.equal(report.ok, true);
  assert.equal(report.signed_records_unchanged, true);
  assert.equal(report.edited_copy.every_signature_valid, true, "signatures must survive for this to prove anything");
  assert.equal(report.edited_copy.comparison_matches, false);
  assert.equal(report.edited_copy.bundle_status, "COMPARISON_ALTERED");
  assert.match(report.explanation, /rejected the edited copy/);
});

test("the result is produced by the verifier, not written into the report", () => {
  const source = fs.readFileSync("src/tamper-demo.js", "utf8");
  // The expected status must appear nowhere: it can only come from verifyBundle.
  assert.equal(source.includes("COMPARISON_ALTERED"), false, "the outcome is hardcoded");
  assert.equal(source.includes("SIGNATURE_INVALID"), false);
  assert.match(source, /await verifyBundle\(altered\)/);
  assert.match(source, /bundle_status !== "VERIFIED"/, "the wording must follow the actual result");
});

test("the original evidence still verifies after the tamper test has run", async () => {
  const bundle = bundleFor(destinationRecord());
  const snapshot = JSON.stringify(bundle);
  const report = await runTamperDemo(bundle);
  assert.equal(report.your_evidence.bundle_status, "VERIFIED");
  assert.equal(JSON.stringify(bundle), snapshot, "the original bundle was mutated");
  // And it still verifies when checked again independently afterwards.
  assert.equal((await verifyBundle(JSON.parse(snapshot))).bundle_status, "VERIFIED");
});

test("an insufficient-evidence bundle is still tampered with only inside the comparison", async () => {
  const bundle = bundleFor(null, "insufficient_evidence");
  const report = await runTamperDemo(bundle);
  assert.equal(report.ok, true);
  assert.equal(report.what_was_edited.path, "comparison.verdict");
  assert.equal(report.signed_records_unchanged, true);
  assert.equal(report.edited_copy.bundle_status, "COMPARISON_ALTERED");
  assert.equal(report.your_evidence.bundle_status, "VERIFIED");
});

test("an agreement bundle is rejected the same way", async () => {
  const report = await runTamperDemo(bundleFor(destinationRecord("ACTION_PRESENT", "agreement"), "agreement"));
  assert.equal(report.what_was_edited.from, true);
  assert.equal(report.what_was_edited.to, false);
  assert.equal(report.edited_copy.bundle_status, "COMPARISON_ALTERED");
  assert.equal(report.your_evidence.bundle_status, "VERIFIED");
});

// ------------------------------------------------- G. agent/page state untouched
test("the tamper test cannot reach page or agent state", () => {
  const source = fs.readFileSync("src/tamper-demo.js", "utf8");
  for (const forbidden of ["store", "document", "state.", "createStore", "modelContext"]) {
    assert.equal(source.includes(forbidden), false, `tamper-demo touches ${forbidden}`);
  }
  const app = fs.readFileSync("src/app.js", "utf8");
  const handler = app.slice(app.indexOf('$("tamper-demo")'));
  const body = handler.slice(0, handler.indexOf("\n});"));
  // It may read state to build a bundle, but must not write to it or re-verify.
  assert.equal(/store\.(verify|reset|requestRefund|getEvidence|compare)\(/.test(body), false, "the tamper test mutates store state");
  assert.equal(/state\.\w+ =/.test(body), false, "the tamper test assigns to page state");
});

// ------------------------------------------------------ WebMCP explanation + UX
test("the page names the four WebMCP tools next to the primary action", () => {
  const html = fs.readFileSync("src/index.html", "utf8");
  const hero = html.slice(html.indexOf('id="run-demo"'), html.indexOf('id="unsupported"'));
  for (const tool of ["request_refund", "get_evidence", "compare_evidence", "verify_evidence"]) {
    assert.ok(hero.includes(tool), `${tool} is not named near the primary action`);
  }
  assert.match(hero, /WebMCP/);
});

test("the evidence trail a human can read is still all present", () => {
  const html = fs.readFileSync("src/index.html", "utf8");
  for (const id of ["timeline", "site-status", "destination-status", "verdict", "diff", "established", "not-established", "verification-status", "download-bundle", "verify-bundle", "tamper-demo"]) {
    assert.ok(html.includes(`id="${id}"`), `the page lost #${id}`);
  }
  assert.match(html, /What can be established/);
  assert.match(html, /What cannot be established/);
  assert.match(html, /not organizationally independent/);
});

// ------------------------------------------------------------- I. narrow viewport
test("narrow viewport rules still avoid overflow and keep the status on one line", () => {
  const css = fs.readFileSync("src/styles.css", "utf8");
  const narrow = css.slice(css.indexOf("@media(max-width:850px){"));
  assert.match(narrow, /\.diff-row span::before\{content:attr\(data-label\)/);
  assert.match(narrow, /\.status\{max-width:none;text-align:right;white-space:nowrap/);
  assert.match(narrow, /\.actions>\*,button,\.button-link\{width:100%\}/);
});
