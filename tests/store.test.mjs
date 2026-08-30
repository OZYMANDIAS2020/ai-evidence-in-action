import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/webmcp-tools.js";

const noop = () => {};

function signedResponse(body, mode = body.mode) {
  return new Response(JSON.stringify({
    ok: true,
    record: {
      schema: "ai-evidence-in-action/demo-evidence/1",
      record_id: `rec_${mode}`,
      record_type: mode === "site" ? "site_claim" : "destination_report",
      claim_id: body.claim_id,
      request_id: body.request_id,
      source: { id: `${mode}-demo`, origin: "https://example.invalid" },
      statement: mode === "site" ? "SUCCESS_DECLARED" : "ACTION_ABSENT",
      subject: { order_id: body.order_id, amount_cents: body.amount_cents, currency: "USD" },
      observed_at: "2026-08-30T04:00:00.000Z",
      integrity: { status: "SIGNED", key_id: `${mode}-demo-2026` }
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("concurrent duplicate request_id performs one signing request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    await new Promise((resolve) => setTimeout(resolve, 25));
    return signedResponse(body, "site");
  };

  try {
    const store = createStore(noop, noop);
    const input = { order_id: "ORD-1042", amount_cents: 6400, request_id: "same-id" };
    const [first, second] = await Promise.all([store.requestRefund(input), store.requestRefund(input)]);
    assert.equal(calls, 1);
    assert.deepEqual([first.duplicate, second.duplicate].sort(), [false, true]);
    assert.equal(first.claim.record_id, second.claim.record_id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sequential replay returns original claim without a second request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => { calls += 1; return signedResponse(JSON.parse(options.body), "site"); };
  try {
    const store = createStore(noop, noop);
    const input = { order_id: "ORD-1042", amount_cents: 6400, request_id: "replay-id" };
    const first = await store.requestRefund(input);
    const second = await store.requestRefund(input);
    assert.equal(calls, 1);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(first.claim.record_id, second.claim.record_id);
  } finally { globalThis.fetch = originalFetch; }
});

test("malformed or out-of-scope synthetic requests fail before network", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("should not be called"); };
  try {
    const store = createStore(noop, noop);
    assert.equal((await store.requestRefund({ order_id: "ORD-9999", amount_cents: 6400, request_id: "x" })).error.code, "ORDER_NOT_FOUND");
    assert.equal((await store.requestRefund({ order_id: "ORD-1042", amount_cents: 1, request_id: "x" })).error.code, "AMOUNT_INVALID");
    assert.equal((await store.requestRefund({ order_id: "ORD-1042", amount_cents: 6400, request_id: "<script>" })).error.code, "REQUEST_ID_INVALID");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("destination outage becomes insufficient evidence, never failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.mode === "site") return signedResponse(body, "site");
    throw new Error("simulated destination outage");
  };
  try {
    const store = createStore(noop, noop);
    const first = await store.requestRefund({ order_id: "ORD-1042", amount_cents: 6400, request_id: "outage-id" });
    const evidence = await store.getEvidence({ claim_id: first.claim.claim_id, source: "destination" });
    const comparison = store.compare({ claim_id: first.claim.claim_id });
    assert.equal(evidence.status, "DESTINATION_UNAVAILABLE");
    assert.equal(comparison.verdict, "INSUFFICIENT_EVIDENCE");
    assert.equal(comparison.reason, "DESTINATION_UNAVAILABLE");
  } finally { globalThis.fetch = originalFetch; }
});
