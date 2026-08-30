import { compareRecords, DEFAULT_SCENARIO, makeBundle, randomId, SCENARIOS, SCHEMA, verifyBundle } from "./evidence.js";

async function requestDemoRecord({ mode, claim_id, request_id, order_id, amount_cents, scenario }) {
  const response = await fetch("/api/demo-record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, claim_id, request_id, order_id, amount_cents, scenario })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok || !result.record) {
    const message = result?.error?.message || `Demo evidence service returned ${response.status}.`;
    const error = new Error(message);
    error.code = result?.error?.code || "DEMO_SERVICE_ERROR";
    throw error;
  }
  return result.record;
}

export async function registerWebMcpTools(store, log) {
  if (!document.modelContext?.registerTool) return { supported: false, controllers: [] };

  const controllers = [];
  const register = async (definition) => {
    const controller = new AbortController();
    controllers.push(controller);
    await document.modelContext.registerTool(definition, { signal: controller.signal });
    log("REGISTERED", definition.name, "ready");
  };

  await register({
    name: "request_refund",
    title: "Request a synthetic refund",
    description: "Request the fixed $64 refund for synthetic demo order ORD-1042 only. This changes demonstration state and performs no real payment or financial transaction. Returns a signed record of what the demo site declared; that record does not prove an external outcome occurred. Requires a client-generated request_id for idempotency. The optional scenario argument selects one of three named server-side synthetic fixtures; it cannot set what any record says.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Synthetic demo order ORD-1042" },
        amount_cents: { type: "integer", minimum: 6400, maximum: 6400, description: "Fixed synthetic demo amount: 6400 cents" },
        request_id: { type: "string", description: "Client-generated idempotency key, 1-128 characters" },
        scenario: { type: "string", enum: SCENARIOS, description: "Named synthetic fixture. disagreement (default): the destination reports no matching action. agreement: the destination reports a matching action. insufficient_evidence: the destination returns no evidence at all." }
      },
      required: ["order_id", "amount_cents", "request_id"],
      additionalProperties: false
    },
    execute: async (input, { signal }) => store.requestRefund(input, signal)
  });

  await register({
    name: "get_evidence",
    title: "Get evidence from a source",
    description: "Fetch current demonstration evidence for a claim from the site or the simulated destination source. Destination output is reported as received and is not vouched for by this page. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        source: { type: "string", enum: ["site", "destination"] }
      },
      required: ["claim_id", "source"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => store.getEvidence(input)
  });

  await register({
    name: "compare_evidence",
    title: "Compare the two sources",
    description: "Compare the site's claim with the currently fetched destination evidence for one claim. Returns exactly one bounded verdict: AGREEMENT, DISAGREEMENT, or INSUFFICIENT_EVIDENCE, plus field-level differences including the two statements themselves. It never guesses which source is correct and emits no confidence score. Read-only.",
    inputSchema: {
      type: "object",
      properties: { claim_id: { type: "string" } },
      required: ["claim_id"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: async (input) => store.compare(input)
  });

  await register({
    name: "verify_evidence",
    title: "Verify demonstration evidence integrity",
    description: "Verify SHA-256 commitments and Ed25519 signatures on the current demonstration evidence bundle against the published demo public keys, then recompute the comparison from the records that verified and check it against the verdict recorded in the bundle. This verifies integrity, demo-key attribution, and comparison consistency only; it does not prove that a real-world financial event occurred or that the simulated sources are organizationally independent. Read-only.",
    inputSchema: {
      type: "object",
      properties: { claim_id: { type: "string" } },
      required: ["claim_id"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: async (input) => store.verify(input)
  });

  return { supported: true, controllers };
}

export function createStore(onChange, log) {
  const state = {
    site: null,
    destination: null,
    destinationUnavailable: false,
    destinationUnavailableReason: null,
    scenario: DEFAULT_SCENARIO,
    comparison: { verdict: "INSUFFICIENT_EVIDENCE", diff: [] },
    verification: null,
    requestIds: new Map()
  };

  const fail = (code, message) => ({ ok: false, error: { code, message } });
  const emit = () => onChange({ ...state });
  const pendingRequests = new Map();

  const clearDerivedState = () => {
    state.destination = null;
    state.destinationUnavailable = false;
    state.destinationUnavailableReason = null;
    state.comparison = { verdict: "INSUFFICIENT_EVIDENCE", diff: [] };
    state.verification = null;
  };

  return {
    state,
    reset() {
      state.site = null;
      state.scenario = DEFAULT_SCENARIO;
      clearDerivedState();
      state.requestIds.clear();
      pendingRequests.clear();
      emit();
    },
    async requestRefund(input, signal) {
      log("CALLED", "request_refund", input?.request_id || "missing request_id");
      if (signal?.aborted) {
        log("CANCELED", "request_refund", "aborted");
        return fail("CANCELED", "Execution was canceled before the demo claim was recorded.");
      }
      if (!input || typeof input.order_id !== "string" || typeof input.amount_cents !== "number" || typeof input.request_id !== "string") {
        return fail("SCHEMA_MISMATCH", "order_id, amount_cents, and request_id are required with the documented types.");
      }
      if (input.order_id !== "ORD-1042") return fail("ORDER_NOT_FOUND", "Only synthetic demo order ORD-1042 is available.");
      if (input.amount_cents !== 6400) return fail("AMOUNT_INVALID", "This demo uses a fixed synthetic refund amount of $64.00.");
      if (!input.request_id || input.request_id.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(input.request_id)) {
        return fail("REQUEST_ID_INVALID", "request_id must be 1-128 safe identifier characters.");
      }
      // The browser does not validate inputSchema on our behalf, so the enum is
      // enforced here as well as on the server.
      const scenario = input.scenario === undefined ? DEFAULT_SCENARIO : input.scenario;
      if (!SCENARIOS.includes(scenario)) {
        return fail("SCENARIO_INVALID", `scenario must be one of: ${SCENARIOS.join(", ")}.`);
      }

      const existing = state.requestIds.get(input.request_id);
      if (existing) {
        const same = existing.subject.order_id === input.order_id && existing.subject.amount_cents === input.amount_cents;
        if (!same) return fail("IDEMPOTENCY_CONFLICT", "This request_id was already used with different input.");
        log("RETURNED", "request_refund", "duplicate:true");
        return {
          ok: true,
          schema: SCHEMA,
          duplicate: true,
          scenario: existing.scenario ?? state.scenario,
          claim: existing,
          established: ["The demo site previously declared acceptance of this synthetic request."],
          not_established: ["Any real-world financial outcome."]
        };
      }

      const pending = pendingRequests.get(input.request_id);
      if (pending) {
        const signedClaim = await pending;
        if (!state.requestIds.has(input.request_id)) {
          state.site = signedClaim;
          state.scenario = signedClaim.scenario ?? scenario;
          clearDerivedState();
          state.requestIds.set(input.request_id, signedClaim);
          emit();
        }
        log("RETURNED", "request_refund", "duplicate:true (concurrent)");
        return {
          ok: true,
          schema: SCHEMA,
          duplicate: true,
          scenario: state.scenario,
          claim: state.requestIds.get(input.request_id),
          established: ["The concurrent call resolved to the same synthetic request record."],
          not_established: ["Any real-world financial outcome."]
        };
      }

      const claimId = randomId("clm");
      const requestPromise = requestDemoRecord({
        mode: "site",
        claim_id: claimId,
        request_id: input.request_id,
        order_id: input.order_id,
        amount_cents: input.amount_cents,
        scenario
      });
      pendingRequests.set(input.request_id, requestPromise);
      try {
        const signedClaim = await requestPromise;
        if (signal?.aborted) {
          log("CANCELED", "request_refund", "aborted after response; no local state committed");
          return fail("CANCELED", "Execution was canceled before the demo claim was committed to page state.");
        }
        state.site = signedClaim;
        state.scenario = signedClaim.scenario ?? scenario;
        clearDerivedState();
        state.requestIds.set(input.request_id, state.site);
        emit();
        log("RETURNED", "request_refund", state.site.statement);
        return {
          ok: true,
          schema: SCHEMA,
          duplicate: false,
          scenario: state.scenario,
          claim: state.site,
          established: ["The demo site declared acceptance of this synthetic request and signed that declaration with its demo key."],
          not_established: ["Any external side effect or real-world financial outcome."]
        };
      } catch (error) {
        log("ERROR", "request_refund", error.code || "DEMO_SERVICE_ERROR");
        return fail(error.code || "DEMO_SERVICE_ERROR", error.message || "The demo evidence service is unavailable.");
      } finally {
        if (pendingRequests.get(input.request_id) === requestPromise) pendingRequests.delete(input.request_id);
      }
    },
    async getEvidence(input) {
      log("CALLED", "get_evidence", input?.source || "missing source");
      if (!state.site || input?.claim_id !== state.site.claim_id) return fail("CLAIM_NOT_FOUND", "No matching demo claim exists.");
      if (!input || !["site", "destination"].includes(input.source)) return fail("SOURCE_UNKNOWN", "source must be site or destination.");
      if (input.source === "site") {
        log("RETURNED", "get_evidence", state.site.statement);
        return { ok: true, schema: SCHEMA, source: "site", status: state.site.statement, records: [state.site], fetched_at: new Date().toISOString() };
      }

      try {
        state.destination = await requestDemoRecord({
          mode: "destination",
          claim_id: state.site.claim_id,
          request_id: state.site.request_id,
          order_id: state.site.subject.order_id,
          amount_cents: state.site.subject.amount_cents,
          // The scenario is taken from the signed site record, so both records in
          // a bundle always come from the same named fixture.
          scenario: state.site.scenario ?? state.scenario
        });
        state.destinationUnavailable = false;
        state.destinationUnavailableReason = null;
        state.verification = null;
        emit();
        log("RETURNED", "get_evidence", state.destination.statement);
        return { ok: true, schema: SCHEMA, source: "destination", status: state.destination.statement, records: [state.destination], fetched_at: new Date().toISOString() };
      } catch (error) {
        state.destination = null;
        state.destinationUnavailable = true;
        state.destinationUnavailableReason = error.code || "DEMO_SERVICE_ERROR";
        state.comparison = { verdict: "INSUFFICIENT_EVIDENCE", missing: ["destination"], diff: [], reason: "DESTINATION_UNAVAILABLE" };
        state.verification = null;
        emit();
        log("RETURNED", "get_evidence", "DESTINATION_UNAVAILABLE");
        return {
          ok: true,
          schema: SCHEMA,
          source: "destination",
          status: "DESTINATION_UNAVAILABLE",
          reason: state.destinationUnavailableReason,
          records: [],
          fetched_at: new Date().toISOString(),
          note: "The simulated destination did not return evidence. No failure outcome is inferred."
        };
      }
    },
    compare(input) {
      log("CALLED", "compare_evidence", input?.claim_id || "missing claim");
      if (!state.site || input?.claim_id !== state.site.claim_id) return fail("CLAIM_NOT_FOUND", "No matching demo claim exists.");
      state.comparison = compareRecords(state.site, state.destination);
      if (state.destinationUnavailable && !state.destination) state.comparison.reason = "DESTINATION_UNAVAILABLE";
      emit();
      log("RETURNED", "compare_evidence", state.comparison.verdict);
      return {
        ok: true,
        schema: SCHEMA,
        ...state.comparison,
        established: ["The deterministic relationship between the currently held demo records."],
        not_established: ["Which source is correct, why they differ, or whether a real-world financial event occurred."]
      };
    },
    async verify(input) {
      log("CALLED", "verify_evidence", input?.claim_id || "missing claim");
      if (!state.site || input?.claim_id !== state.site.claim_id) return fail("CLAIM_NOT_FOUND", "No matching demo claim exists.");
      const bundle = makeBundle(state.site, state.destination, state.comparison);
      try {
        const verification = await verifyBundle(bundle);
        state.verification = verification;
        emit();
        log("RETURNED", "verify_evidence", verification.bundle_status || verification.error?.code || "ERROR");
        return {
          ...verification,
          schema: SCHEMA,
          bundle,
          establishes: [
            "Integrity of the signed demo records and attribution to the published demo keys when SIGNATURE_VALID.",
            "That the verdict recorded in the bundle is the verdict recomputed from the records that verified, when verdict_matches is true."
          ],
          does_not_establish: ["Truth of the signed statements, real-world identity, trusted time, or source independence."]
        };
      } catch (error) {
        log("ERROR", "verify_evidence", error?.message || String(error));
        return fail("VERIFICATION_UNAVAILABLE", error?.message || "Verification could not be completed.");
      }
    }
  };
}
