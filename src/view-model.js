import { DESTINATION_STATEMENTS, SITE_STATEMENTS } from "./evidence.js";

/**
 * Every visible sentence about a source is computed here from that source's
 * actual record. Nothing in this module assumes which statement a source will
 * return, so a fixture change cannot leave stale prose on the page. A statement
 * outside the published vocabulary is quoted verbatim rather than described.
 */
const STATEMENT_GLOSS = {
  SUCCESS_DECLARED: "the demo site declares the synthetic refund succeeded",
  ACTION_PRESENT: "the simulated destination reports a matching action",
  ACTION_ABSENT: "the simulated destination reports no matching action"
};

export const KNOWN_STATEMENTS = [...SITE_STATEMENTS, ...DESTINATION_STATEMENTS];

export function formatAmount(subject) {
  if (!subject || typeof subject.amount_cents !== "number") return "unknown amount";
  return `${(subject.amount_cents / 100).toFixed(2)} ${subject.currency || ""}`.trim();
}

function describeStatement(statement) {
  return STATEMENT_GLOSS[statement] ? `${statement} — ${STATEMENT_GLOSS[statement]}` : `${statement} — statement not in the published demo vocabulary`;
}

export function sourceDetail(record) {
  if (!record) return null;
  return `Signed record ${record.record_id} states ${describeStatement(record.statement)} for order ${record.subject?.order_id} at ${formatAmount(record.subject)}.`;
}

export function signatureText(record) {
  if (!record) return "No signed record yet";
  if (record.integrity?.status === "SIGNED") return `SIGNED · ${record.integrity.key_id}`;
  return record.integrity?.status || "NOT SIGNED";
}

export function buildViewModel(state) {
  const site = state.site || null;
  const destination = state.destination || null;
  const verdict = state.comparison?.verdict || "INSUFFICIENT_EVIDENCE";

  const destinationStatus = destination?.statement || (state.destinationUnavailable ? "DESTINATION_UNAVAILABLE" : "NOT CHECKED");
  const destinationDetail = destination
    ? sourceDetail(destination)
    : state.destinationUnavailable
      ? "The simulated destination returned no evidence for this claim. Missing evidence is not treated as failure."
      : "No destination evidence has been fetched yet.";

  const verdictDetail = verdict === "DISAGREEMENT"
    ? "The two signed records do not correspond on every compared field. The demo does not decide which one is right."
    : verdict === "AGREEMENT"
      ? "The two signed records correspond on every compared field."
      : state.comparison?.reason === "STATEMENT_NOT_COMPARABLE"
        ? "The two statements are not in the published correspondence table, so no verdict is computed."
        : state.destinationUnavailable
          ? "The comparison source returned no evidence. Missing evidence is not treated as failure."
          : "A second source has not been checked yet.";

  const established = [];
  if (site) established.push(`The demo site signed a record stating ${site.statement} for the synthetic request.`);
  if (destination) established.push(`The simulated destination signed a record stating ${destination.statement}.`);
  if (verdict === "DISAGREEMENT") established.push("The two held records conflict on at least one compared field.");
  if (verdict === "AGREEMENT") established.push("The two held records agree on every compared field.");
  if (state.verification?.overall === "SIGNATURE_VALID") established.push("The current signed records pass hash and Ed25519 signature verification against the published demo keys.");
  if (state.verification?.verdict_matches === true) established.push("The recorded verdict matches the verdict recomputed from the verified records.");
  if (state.verification?.verdict_matches === false) established.push("The recorded verdict does NOT match the verdict recomputed from the verified records.");

  return {
    site: {
      status: site?.statement || "NO CLAIM",
      detail: site ? sourceDetail(site) : "No refund claim has been recorded yet.",
      integrity: signatureText(site)
    },
    destination: {
      status: destinationStatus,
      detail: destinationDetail,
      integrity: signatureText(destination)
    },
    comparison: {
      verdict,
      label: verdict.replaceAll("_", " "),
      detail: verdictDetail,
      diff: state.comparison?.diff || [],
      isDisagreement: verdict === "DISAGREEMENT"
    },
    established: established.length ? established : ["No claim has been recorded yet."],
    notEstablished: [
      "Whether money actually moved.",
      "Which source is correct or why the records differ.",
      "The identity of any real-world party.",
      "That the simulated sources are organizationally independent.",
      "Trusted wall-clock time or exactly-once execution outside this demo."
    ],
    verificationStatus: state.verification?.bundle_status || state.verification?.overall || "NOT VERIFIED YET",
    scenario: state.scenario || null
  };
}
