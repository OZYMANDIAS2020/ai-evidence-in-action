# WebMCP Challenge build record

AI Evidence in Action is an existing-concept / new-implementation entry. A private pre-existing concept explored checking what a system reports against evidence from another source. This public repository contains the new challenge-period WebMCP implementation only.

## Challenge-period work

The public implementation is being built during the WebMCP Challenge submission period and is intentionally limited to synthetic demonstration data and deliberately public technology.

Current public build includes:

- four imperative WebMCP tool definitions on `document.modelContext`
- fixed synthetic refund claim flow for `ORD-1042` / $64.00
- simulated comparison-source evidence
- bounded comparison results: `AGREEMENT`, `DISAGREEMENT`, `INSUFFICIENT_EVIDENCE`
- source-scoped SHA-256 commitments and Ed25519 demo signatures
- published demo public keys
- an offline verifier with a clean signed fixture and a deliberate one-field tamper fixture
- a shared human/agent evidence board
- explicit limitations and unsupported-browser behavior
- automated tests for the comparison semantics, WebMCP surface, and offline verifier

## Publication boundary

This repository is intentionally standalone. It contains no private production source code, private repository history, credentials, customer information, or unpublished proprietary implementation details.

## Status

Build in progress. The signed demonstration evidence and offline verifier are implemented and locally falsified against the tampered fixture. Production WebMCP browser testing, full P0 attack validation, final video, and final challenge submission remain to be completed and will not be claimed complete until measured.
