import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import demoRecord from "../netlify/functions/demo-record.mjs";

const root = randomBytes(48).toString("base64");
globalThis.Netlify = { env: { get: () => root } };

function request(body, method = "POST") {
  return new Request("https://example.invalid/api/demo-record", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined
  });
}

const valid = { mode: "site", claim_id: "clm_test", request_id: "req_test", order_id: "ORD-1042", amount_cents: 6400 };

test("demo record function rejects non-POST", async () => {
  const response = await demoRecord(request(null, "GET"));
  assert.equal(response.status, 405);
});

test("demo record function rejects unsupported mode", async () => {
  const response = await demoRecord(request({ ...valid, mode: "other" }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "MODE_INVALID");
});

test("demo record function rejects non-demo inputs", async () => {
  const response = await demoRecord(request({ ...valid, amount_cents: 1 }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "DEMO_INPUT_INVALID");
});

test("demo record function rejects unsafe identifiers", async () => {
  const response = await demoRecord(request({ ...valid, request_id: "<script>alert(1)</script>" }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "IDENTIFIER_INVALID");
});

test("demo record function emits bounded signed site and destination records", async () => {
  const siteResponse = await demoRecord(request(valid));
  const site = (await siteResponse.json()).record;
  assert.equal(site.statement, "SUCCESS_DECLARED");
  assert.equal(site.integrity.status, "SIGNED");
  assert.equal(site.integrity.key_id, "site-demo-2026");

  const destinationResponse = await demoRecord(request({ ...valid, mode: "destination" }));
  const destination = (await destinationResponse.json()).record;
  assert.equal(destination.statement, "ACTION_ABSENT");
  assert.equal(destination.integrity.status, "SIGNED");
  assert.equal(destination.integrity.key_id, "destination-demo-2026");
});
