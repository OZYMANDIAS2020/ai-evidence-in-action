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
- a pairing gate over signed fields (`claim_id`, `request_id`, `scenario`), so validly signed records from different claims cannot be spliced into a verified pair
- verification that recomputes the whole comparison from verified records — verdict, every diff row, `reason`, `missing`, and the published correspondence table — and reports `comparison_matches` alongside a content-derived comparison digest
- one bounded bundle status: `VERIFIED`, `SIGNATURE_INVALID`, `CLAIM_PAIR_MISMATCH`, or `COMPARISON_ALTERED`
- an offline verifier with a clean fixture, a record-tamper fixture, and a verdict-tamper fixture, held to the same conclusions as the browser by a cross-verifier equivalence suite
- one evidence board shared by the human and the agent
- explicit limitations and unsupported-browser behavior
- automated tests for comparison semantics, fixture reachability, request-override resistance, signature verification, verdict-tamper detection, the WebMCP surface, the offline verifier, publication safety, and live production signed records

## Measurement notes

Claims here are limited to what has been run.

- The full test suite runs under `node --test` and is reported as executed, not estimated.
- The three fixtures were exercised end to end in a real browser against the real signing function running locally with a throwaway key, including browser-side Ed25519 verification and verdict-tamper detection.
- The four tools were registered, discovered and executed against a **native** WebMCP runtime: Chrome 152.0.7977.64 with `chrome://flags/#enable-webmcp-testing`. `document.modelContext` is a `ModelContext` extending `EventTarget`; `navigator.modelContext` is absent in that build. Every call in that run went through `getTools()` and `executeTool()`; the page's own scripted transport was not used.
- The unsupported-browser fallback was separately observed working in a browser that does not expose the API.

### Measured runtime behaviour

Observed in Chrome 152.0.7977.64. These are measurements of one implementation, not statements about the specification, and the page is written so that none of them has to hold:

- `executeTool(tool, args)` takes the `RegisteredTool` returned by `getTools()` and its arguments **as a JSON string**. A plain object is rejected with `Failed to parse input arguments`.
- A tool's `execute()` is invoked with **exactly one argument**. There is no second options argument, so no `AbortSignal` reaches the tool body.
- Results are returned to the caller **as a JSON string**.
- `inputSchema` comes back from `getTools()` as a **string**, not the object that was registered.
- The runtime does **not** enforce `inputSchema`. A payload omitting a required property, using the wrong type, and adding an undeclared property was passed through to `execute()` unchanged. Every tool therefore validates its own input, and each of those refusals is covered by a test.

The first two were found only by running against the native runtime; both are pinned by regression tests.

## Publication boundary

This repository is intentionally standalone. It contains no private production source code, private repository history, credentials, customer information, or unpublished proprietary implementation details. Publication safety is enforced by tests that look for structural signatures of secret material rather than for a list of names, so the guard itself stays publishable.

## Status

Build in progress. Signed demonstration evidence, comparison recomputation, and the offline verifier are implemented and falsified against both tamper fixtures. Production signing configuration is isolated to the function environment and is not stored in this repository. Native WebMCP execution of all four tools has been observed and is recorded above. The final video and the final challenge submission remain to be completed and are not claimed complete until measured.
