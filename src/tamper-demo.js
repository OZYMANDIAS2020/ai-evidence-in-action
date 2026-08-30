import { canonicalize, verifyBundle } from "./evidence.js";

/**
 * Edits a throwaway copy of the evidence so a reader can watch verification
 * reject it. Nothing here is staged: the copy goes through the same
 * verifyBundle the page uses for ordinary verification, and the outcome is
 * whatever that function returns. The only edit is inside the recorded
 * comparison; the signed records are never touched, which is the whole point —
 * every signature still passes and the bundle is rejected anyway.
 */
export function alterRecordedComparison(bundle) {
  const altered = structuredClone(bundle);
  const row = altered.comparison?.diff?.[0];
  if (row) {
    const from = row.match;
    row.match = !row.match;
    return { altered, change: { path: "comparison.diff[0].match", field: row.field, from, to: row.match } };
  }
  // With no diff rows to flip (no destination record), the verdict is the only
  // comparison value there is.
  const from = altered.comparison?.verdict ?? null;
  altered.comparison = { ...altered.comparison, verdict: from === "AGREEMENT" ? "DISAGREEMENT" : "AGREEMENT" };
  return { altered, change: { path: "comparison.verdict", field: "verdict", from, to: altered.comparison.verdict } };
}

export async function runTamperDemo(bundle) {
  if (!bundle || !Array.isArray(bundle.records) || bundle.records.length === 0) {
    return { ok: false, error: { code: "NO_EVIDENCE", message: "There is no evidence to test yet. Run the demo first." } };
  }

  const { altered, change } = alterRecordedComparison(bundle);
  const alteredResult = await verifyBundle(altered);
  const originalResult = await verifyBundle(structuredClone(bundle));
  const recordsUnchanged = canonicalize(bundle.records) === canonicalize(altered.records);
  const detected = alteredResult.bundle_status !== "VERIFIED";

  const summarise = (result) => ({
    bundle_status: result.bundle_status,
    every_signature_valid: result.checks.every((check) => check.signature_valid && check.hash_valid),
    comparison_matches: result.comparison_matches,
    recorded_verdict: result.recorded_verdict,
    recomputed_verdict: result.recomputed_comparison?.verdict ?? null
  });

  return {
    ok: true,
    what_was_edited: change,
    signed_records_unchanged: recordsUnchanged,
    edited_copy: summarise(alteredResult),
    your_evidence: summarise(originalResult),
    // Stated from the result that was actually produced, never assumed.
    explanation: detected
      ? "The signed records were unchanged. Only the recorded comparison was edited. The verifier recomputed the comparison from the records and rejected the edited copy. Your own evidence is untouched and still verifies."
      : "The signed records were unchanged and the edited copy was still accepted. That is a defect in this demo, not a feature: please report it."
  };
}
