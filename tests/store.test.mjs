import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/webmcp-tools.js";

const noop = () => {};

/**
 * Stands in for the signing function. Statements come from the same fixture
 * table the server uses, so the store is never the thing that decides what a
 * record says.
 */
const FIXTURES = {
  disagreement: { site: "SUCCESS_DECLARED", destination: "ACTION_ABSENT" },
  agreement: { site: "SUCCESS_DECLARED", destination: "ACTION_PRESENT" },
  insufficient_evidence: { site: "SUCCESS_DECLARED", destination: null }
};

function signedResponse(body, mode = body.mode) {
  const scenario = body.scenario || "disagreement";
  const statement = mode === "site" ? FIXTURES[scenario].site : FIXTURES[scenario].destination;
  if (statement === null) {
    return new Response(JSON.stringify({ ok: false, error: { code: "DESTINATION_EVIDENCE_UNAVAILABLE", message: "no evidence" } }), { status: 503, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({
    ok: true,
    record: {
      schema: "ai-evidence-in-action/demo-evidence/1",
      record_id: `rec_${mode}`,
      record_type: mode === "site" ? "site_claim" : "destination_report",
      claim_id: body.claim_id,
      request_id: body.request_id,
      scenario,
      source: { id: `${mode}-demo`, origin: "https://example.invalid" },
      statement,
      subject: { order_id: body.order_id, amount_cents: body.amount_cents, currency: "USD" },
      observed_at: "2026-08-30T04:00:00.000Z",
      integrity: { status: "SIGNED", key_id: `${mode}-demo-2026` }
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function withFetch(handler, body) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(body()).finally(() => { globalThis.fetch = originalFetch; });
}

const fixtureFetch = async (_url, options) => {
  const parsed = JSON.parse(options.body);
  return signedResponse(parsed, parsed.mode);
};

async function runScenario(scenario) {
  const store = createStore(noop, noop);
  const first = await store.requestRefund({ order_id: "ORD-1042", amount_cents: 6400, request_id: `req-${scenario}`, scenario });
  assert.equal(first.ok, true, JSON.stringify(first));
  const evidence = await store.getEvidence({ claim_id: first.claim.claim_id, source: "destination" });
  const comparison = store.compare({ claim_id: first.claim.claim_id });
  return { store, first, evidence, comparison };
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

test("an unknown scenario is refused by the page before any network call", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("should not be called"); };
  try {
    const store = createStore(noop, noop);
    const result = await store.requestRefund({ order_id: "ORD-1042", amount_cents: 6400, request_id: "sc", scenario: "always_agree" });
    assert.equal(result.error.code, "SCENARIO_INVALID");
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

test("the disagreement fixture reaches DISAGREEMENT with a visible statement conflict", async () => {
  await withFetch(fixtureFetch, async () => {
    const { comparison } = await runScenario("disagreement");
    assert.equal(comparison.verdict, "DISAGREEMENT");
    const statement = comparison.diff.find((row) => row.field === "statement");
    assert.equal(statement.site_value, "SUCCESS_DECLARED");
    assert.equal(statement.destination_value, "ACTION_ABSENT");
    assert.equal(statement.match, false);
  });
});

test("the agreement fixture reaches AGREEMENT", async () => {
  await withFetch(fixtureFetch, async () => {
    const { evidence, comparison } = await runScenario("agreement");
    assert.equal(evidence.status, "ACTION_PRESENT");
    assert.equal(comparison.verdict, "AGREEMENT");
    assert.equal(comparison.diff.every((row) => row.match), true);
  });
});

test("the insufficient-evidence fixture reaches INSUFFICIENT_EVIDENCE", async () => {
  await withFetch(fixtureFetch, async () => {
    const { store, evidence, comparison } = await runScenario("insufficient_evidence");
    assert.equal(evidence.status, "DESTINATION_UNAVAILABLE");
    assert.equal(evidence.reason, "DESTINATION_EVIDENCE_UNAVAILABLE");
    assert.equal(comparison.verdict, "INSUFFICIENT_EVIDENCE");
    assert.equal(store.state.destination, null);
  });
});

test("the destination request reuses the scenario bound into the signed site record", async () => {
  const seen = [];
  await withFetch(async (_url, options) => {
    const parsed = JSON.parse(options.body);
    seen.push([parsed.mode, parsed.scenario]);
    return signedResponse(parsed, parsed.mode);
  }, async () => {
    const store = createStore(noop, noop);
    const first = await store.requestRefund({ order_id: "ORD-1042", amount_cents: 6400, request_id: "bound", scenario: "agreement" });
    await store.getEvidence({ claim_id: first.claim.claim_id, source: "destination" });
  });
  assert.deepEqual(seen, [["site", "agreement"], ["destination", "agreement"]]);
});

test("changing scenario after a claim requires a reset, and reset clears every derived field", async () => {
  await withFetch(fixtureFetch, async () => {
    const { store } = await runScenario("disagreement");
    assert.notEqual(store.state.comparison.verdict, "INSUFFICIENT_EVIDENCE");
    store.reset();
    assert.equal(store.state.site, null);
    assert.equal(store.state.destination, null);
    assert.equal(store.state.destinationUnavailable, false);
    assert.equal(store.state.verification, null);
    assert.equal(store.state.comparison.verdict, "INSUFFICIENT_EVIDENCE");
    assert.deepEqual(store.state.comparison.diff, []);
  });
});

test("evidence and comparison for an unknown claim are refused", async () => {
  await withFetch(fixtureFetch, async () => {
    const store = createStore(noop, noop);
    assert.equal((await store.getEvidence({ claim_id: "clm_nope", source: "destination" })).error.code, "CLAIM_NOT_FOUND");
    assert.equal(store.compare({ claim_id: "clm_nope" }).error.code, "CLAIM_NOT_FOUND");
    assert.equal((await store.verify({ claim_id: "clm_nope" })).error.code, "CLAIM_NOT_FOUND");
  });
});
