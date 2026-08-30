import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const verifier = "src/downloads/verify.mjs";
const run = (bundle) => spawnSync(process.execPath, [verifier, bundle], { encoding: "utf8" });

test("offline verifier accepts the signed example bundle", () => {
  const result = run("src/downloads/bundle.example.json");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /signature is valid for its published demo key: YES/i);
  assert.match(result.stdout, /verdict matches the bundle: YES/i);
  assert.match(result.stdout, /BUNDLE STATUS: VERIFIED/);
});

test("offline verifier rejects a one-field tamper", () => {
  const result = run("src/downloads/bundle.tampered.json");
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stdout, /signature is valid for its published demo key: NO/i);
  assert.match(result.stdout, /rec_example_destination/);
  assert.match(result.stdout, /BUNDLE STATUS: SIGNATURE_INVALID/);
});

test("offline verifier rejects a bundle whose verdict alone was edited", () => {
  const result = run("src/downloads/bundle.verdict-tampered.json");
  assert.equal(result.status, 2, result.stderr || result.stdout);
  // Every signature still passes; only the recomputation catches this.
  assert.match(result.stdout, /each record's canonical hash matches payload_sha256: YES/i);
  assert.match(result.stdout, /signature is valid for its published demo key: YES/i);
  assert.match(result.stdout, /verdict matches the bundle: NO/i);
  assert.match(result.stdout, /BUNDLE STATUS: COMPARISON_ALTERED/);
});

test("the verdict-tamper fixture differs from the clean one only in the comparison", () => {
  const clean = JSON.parse(fs.readFileSync("src/downloads/bundle.example.json", "utf8"));
  const tampered = JSON.parse(fs.readFileSync("src/downloads/bundle.verdict-tampered.json", "utf8"));
  assert.deepEqual(tampered.records, clean.records, "the records must be byte-identical for this fixture to prove anything");
  assert.equal(clean.comparison.verdict, "DISAGREEMENT");
  assert.equal(tampered.comparison.verdict, "AGREEMENT");
});

test("the example bundle shows the statement conflict, not four agreeing rows", () => {
  const bundle = JSON.parse(fs.readFileSync("src/downloads/bundle.example.json", "utf8"));
  const statement = bundle.comparison.diff.find((row) => row.field === "statement");
  assert.equal(statement.site_value, "SUCCESS_DECLARED");
  assert.equal(statement.destination_value, "ACTION_ABSENT");
  assert.equal(statement.match, false);
  assert.equal(bundle.comparison.verdict, "DISAGREEMENT");
});

test("offline verifier refuses a malformed bundle without claiming a verdict", () => {
  const result = run("src/downloads/does-not-exist.json");
  assert.equal(result.status, 3);
  assert.equal(result.stdout.includes("BUNDLE STATUS"), false);
});

test("the offline verifier contains no private key material", () => {
  const source = fs.readFileSync(verifier, "utf8");
  assert.equal(/PRIVATE KEY/.test(source), false);
  assert.equal(source.includes("createPrivateKey"), false);
  assert.equal(source.includes("createHmac"), false);
  assert.equal(source.includes("sign("), false);
});
