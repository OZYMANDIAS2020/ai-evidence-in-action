# WebMCP Challenge build record

AI Evidence in Action is an existing-concept / new-implementation entry. A private pre-existing concept explored checking what a system reports against evidence from another source. This public repository contains the new challenge-period WebMCP implementation only.

## Challenge-period work

The public implementation is being built during the WebMCP Challenge submission period and is intentionally limited to synthetic demonstration data and deliberately public technology.

Current public build includes:

- four imperative WebMCP tool definitions on `document.modelContext`
- fixed synthetic refund claim flow for `ORD-1042` / $64.00
- three named server-side fixtures reaching all three bounded verdicts: `disagreement`, `agreement`, `insufficient_evidence`
- a comparison that shows the two statements themselves, so the conflict is visible rather than implied
- a declared statement-correspondence table, published in every bundle
- bounded comparison results: `AGREEMENT`, `DISAGREEMENT`, `INSUFFICIENT_EVIDENCE`
- source-scoped SHA-256 commitments and Ed25519 demo signatures
- published demo public keys; signing secret held only in the function environment
- verification that recomputes the comparison from verified records and reports `verdict_matches`
- an offline verifier with a clean fixture, a record-tamper fixture, and a verdict-tamper fixture
- one evidence board shared by the human and the agent
- explicit limitations and unsupported-browser behavior
- automated tests for comparison semantics, fixture reachability, request-override resistance, signature verification, verdict-tamper detection, the WebMCP surface, the offline verifier, publication safety, and live production signed records

## Measurement notes

Claims here are limited to what has been run.

- The full test suite runs under `node --test` and is reported as executed, not estimated.
- The three fixtures were exercised end to end in a real browser against the real signing function running locally with a throwaway key, including browser-side Ed25519 verification and verdict-tamper detection.
- `document.modelContext` was **not** present in the browser available for this build, so the WebMCP registration path itself has not been observed executing natively. The unsupported-browser fallback was observed working in that same real browser.
- Because the runtime could not be observed, the page validates every tool input itself rather than assuming the browser enforces `inputSchema`, and the one place that adapts a tool result is isolated and fails closed.

## Publication boundary

This repository is intentionally standalone. It contains no private production source code, private repository history, credentials, customer information, or unpublished proprietary implementation details. Publication safety is enforced by tests that look for structural signatures of secret material rather than for a list of names, so the guard itself stays publishable.

## Status

Build in progress. Signed demonstration evidence, comparison recomputation, and the offline verifier are implemented and falsified against both tamper fixtures. Production signing configuration is isolated to the function environment and is not stored in this repository. Native WebMCP browser testing, the final video, and the final challenge submission remain to be completed and are not claimed complete until measured.
