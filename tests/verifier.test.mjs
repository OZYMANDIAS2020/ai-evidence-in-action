import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const verifier = "src/downloads/verify.mjs";

test("offline verifier accepts the signed example bundle", () => {
  const result = spawnSync(process.execPath, [verifier, "src/downloads/bundle.example.json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /signature is valid for its published demo key: YES/i);
  assert.match(result.stdout, /verdict matches the bundle: YES/i);
});

test("offline verifier rejects a one-field tamper", () => {
  const result = spawnSync(process.execPath, [verifier, "src/downloads/bundle.tampered.json"], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stdout, /signature is valid for its published demo key: NO/i);
  assert.match(result.stdout, /rec_example_destination/);
});
