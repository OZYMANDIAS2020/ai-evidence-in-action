export const SCHEMA = "ai-evidence-in-action/demo-evidence/1";

export function randomId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeSiteClaim({ order_id, amount_cents, request_id }) {
  return {
    schema: SCHEMA,
    record_id: randomId("rec"),
    record_type: "site_claim",
    claim_id: randomId("clm"),
    request_id,
    source: { id: "site-demo", origin: location.origin },
    statement: "SUCCESS_DECLARED",
    subject: { order_id, amount_cents, currency: "USD" },
    observed_at: nowIso(),
    integrity: { status: "NOT_SIGNED", note: "Challenge build: cryptographic signing is being added." }
  };
}

export function makeDestinationReport(siteClaim) {
  return {
    schema: SCHEMA,
    record_id: randomId("rec"),
    record_type: "destination_report",
    claim_id: siteClaim.claim_id,
    source: { id: "destination-demo", origin: location.origin },
    statement: "ACTION_ABSENT",
    subject: { ...siteClaim.subject },
    observed_at: nowIso(),
    integrity: { status: "NOT_SIGNED", note: "Challenge build: cryptographic signing is being added." }
  };
}

export function compareRecords(site, destination) {
  if (!site || !destination) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      missing: [!site ? "site" : null, !destination ? "destination" : null].filter(Boolean),
      diff: []
    };
  }

  const fields = ["order_id", "amount_cents", "currency"];
  const diff = fields.map((field) => ({
    field,
    site_value: site.subject[field],
    destination_value: destination.subject[field],
    match: site.subject[field] === destination.subject[field]
  }));

  const actionPresent = destination.statement === "ACTION_PRESENT";
  const allMatch = diff.every((row) => row.match);
  return { verdict: actionPresent && allMatch ? "AGREEMENT" : "DISAGREEMENT", diff };
}

export function makeBundle(site, destination, comparison) {
  return {
    schema: SCHEMA,
    created_at: nowIso(),
    records: [site, destination].filter(Boolean),
    comparison,
    limitations: [
      "Synthetic demonstration data only.",
      "The destination source is simulated.",
      "This build does not prove any real-world financial event occurred.",
      "Cryptographic signing is not yet enabled in this build."
    ]
  };
}
