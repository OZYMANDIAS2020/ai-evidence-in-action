import { compareRecords, makeBundle, makeDestinationReport, makeSiteClaim, SCHEMA } from "./evidence.js";

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
    description: "Request a refund for a synthetic demo order only. This changes only local demonstration state and performs no real payment or financial transaction. Returns the web application's claim about the request; the claim does not prove an external outcome occurred. Requires a client-generated request_id for idempotency.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Synthetic demo order, for example ORD-1042" },
        amount_cents: { type: "integer", minimum: 1, maximum: 100000 },
        request_id: { type: "string", description: "Client-generated idempotency key" }
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
    description: "Compare the site's claim with the destination evidence for one claim. Returns exactly one bounded verdict: AGREEMENT, DISAGREEMENT, or INSUFFICIENT_EVIDENCE, plus field-level differences. It never guesses which source is correct. Read-only.",
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
    description: "Inspect the current public demonstration evidence bundle. This early challenge build reports integrity as NOT_SIGNED until cryptographic signing is enabled. It does not verify that any real-world event occurred. Read-only.",
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
    comparison: { verdict: "INSUFFICIENT_EVIDENCE", diff: [] },
    requestIds: new Map()
  };

  const fail = (code, message) => ({ ok: false, error: { code, message } });
  const emit = () => onChange({ ...state });

  return {
    state,
    reset() {
      state.site = null;
      state.destination = null;
      state.comparison = { verdict: "INSUFFICIENT_EVIDENCE", diff: [] };
      state.requestIds.clear();
      emit();
    },
    requestRefund(input, signal) {
      log("CALLED", "request_refund", input?.request_id || "missing request_id");
      if (signal?.aborted) {
        log("CANCELED", "request_refund", "aborted");
        return fail("CANCELED", "Execution was canceled before the demo claim was recorded.");
      }
      if (!input || typeof input.order_id !== "string" || typeof input.amount_cents !== "number" || typeof input.request_id !== "string") {
        return fail("SCHEMA_MISMATCH", "order_id, amount_cents, and request_id are required with the documented types.");
      }
      if (input.order_id !== "ORD-1042") return fail("ORDER_NOT_FOUND", "Only synthetic demo order ORD-1042 is available.");
      if (!Number.isInteger(input.amount_cents) || input.amount_cents < 1 || input.amount_cents > 100000) {
        return fail("AMOUNT_INVALID", "amount_cents must be an integer between 1 and 100000.");
      }
      if (!input.request_id || input.request_id.length > 128) return fail("REQUEST_ID_INVALID", "request_id must be between 1 and 128 characters.");

      const existing = state.requestIds.get(input.request_id);
      if (existing) {
        const same = existing.subject.order_id === input.order_id && existing.subject.amount_cents === input.amount_cents;
        if (!same) return fail("IDEMPOTENCY_CONFLICT", "This request_id was already used with different input.");
        log("RETURNED", "request_refund", "duplicate:true");
        return {
          ok: true,
          schema: SCHEMA,
          duplicate: true,
          claim: existing,
          established: ["The site previously declared acceptance of this synthetic request."],
          not_established: ["Any real-world financial outcome."]
        };
      }

      state.site = makeSiteClaim(input);
      state.destination = null;
      state.comparison = { verdict: "INSUFFICIENT_EVIDENCE", diff: [] };
      state.requestIds.set(input.request_id, state.site);
      emit();
      log("RETURNED", "request_refund", "SUCCESS_DECLARED");
      return {
        ok: true,
        schema: SCHEMA,
        duplicate: false,
        claim: state.site,
        established: ["The site declared acceptance of this synthetic request."],
        not_established: ["Any external side effect or real-world financial outcome."]
      };
    },
    getEvidence(input) {
      log("CALLED", "get_evidence", input?.source || "missing source");
      if (!state.site || input?.claim_id !== state.site.claim_id) return fail("CLAIM_NOT_FOUND", "No matching demo claim exists.");
      if (!input || !["site", "destination"].includes(input.source)) return fail("SOURCE_UNKNOWN", "source must be site or destination.");
      if (input.source === "destination" && !state.destination) state.destination = makeDestinationReport(state.site);
      const record = input.source === "site" ? state.site : state.destination;
      emit();
      log("RETURNED", "get_evidence", record.statement);
      return { ok: true, schema: SCHEMA, source: input.source, status: record.statement, records: [record], fetched_at: new Date().toISOString() };
    },
    compare(input) {
      log("CALLED", "compare_evidence", input?.claim_id || "missing claim");
      if (!state.site || input?.claim_id !== state.site.claim_id) return fail("CLAIM_NOT_FOUND", "No matching demo claim exists.");
      state.comparison = compareRecords(state.site, state.destination);
      emit();
      log("RETURNED", "compare_evidence", state.comparison.verdict);
      return {
        ok: true,
        schema: SCHEMA,
        ...state.comparison,
        established: ["The deterministic relationship between the currently held demo records."],
        not_established: ["Which source is correct or why they differ."]
      };
    },
    verify(input) {
      log("CALLED", "verify_evidence", input?.claim_id || "missing claim");
      if (!state.site || input?.claim_id !== state.site.claim_id) return fail("CLAIM_NOT_FOUND", "No matching demo claim exists.");
      const bundle = makeBundle(state.site, state.destination, state.comparison);
      log("RETURNED", "verify_evidence", "NOT_SIGNED");
      return {
        ok: true,
        schema: SCHEMA,
        overall: "NOT_SIGNED",
        checks: bundle.records.map((record) => ({ record_id: record.record_id, integrity: "NOT_SIGNED" })),
        bundle,
        note: "Cryptographic signing is intentionally not claimed in this early build."
      };
    }
  };
}
