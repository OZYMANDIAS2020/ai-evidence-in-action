# AI Evidence in Action

AI Evidence in Action is a WebMCP Challenge project showing a simple evidence pattern for AI actions on the web: record what the site reports, check a second simulated source, compare the records, and state only what the available evidence supports.

**The system reporting an action should not have to be the only source of evidence about whether that action occurred.**

## Live demo

https://ai-evidence-in-action.netlify.app/

## Why WebMCP

The human and the agent work on the same live application state. The agent acts through the page's registered tools; the same evidence board the human is reading updates as it goes. The agent fetches the second source, the disagreement appears, and the human sees exactly the disagreement the agent saw — no separate agent transcript to reconcile against the UI.

Signing and comparison do **not** require WebMCP and this project does not claim they do. What WebMCP contributes here is the shared human/agent surface and a bounded tool interface: four named tools, declared schemas, and no ability for a caller to state a conclusion the page did not compute.

## Current WebMCP tools

| Tool | Purpose |
| --- | --- |
| `request_refund` | Creates a fixed synthetic $64 refund claim for demo order `ORD-1042`. Performs no real financial action. Takes an optional `scenario` selecting one of three named server-side fixtures. |
| `get_evidence` | Reads evidence from the site or simulated destination source. |
| `compare_evidence` | Returns `AGREEMENT`, `DISAGREEMENT`, or `INSUFFICIENT_EVIDENCE` with field-level differences, including the two statements themselves. |
| `verify_evidence` | Recomputes SHA-256 commitments, checks Ed25519 signatures against published demo public keys, and recomputes the comparison from the records that verified. |

The implementation uses the imperative WebMCP surface on `document.modelContext`, with `AbortSignal` registration lifecycles and the currently specified `readOnlyHint` / `untrustedContentHint` annotations.

## Demo scenarios

The challenge uses synthetic order `ORD-1042` for **$64.00**. Three fixtures are reachable from the page and from `request_refund`:

| Fixture | Site statement | Destination | Verdict |
| --- | --- | --- | --- |
| `disagreement` (default) | `SUCCESS_DECLARED` | `ACTION_ABSENT` | `DISAGREEMENT` |
| `agreement` | `SUCCESS_DECLARED` | `ACTION_PRESENT` | `AGREEMENT` |
| `insufficient_evidence` | `SUCCESS_DECLARED` | returns no evidence | `INSUFFICIENT_EVIDENCE` |

The fixture selects which synthetic situation the demo replays. It cannot set what any record says: every statement is chosen from a server-side table and signed on the server, and a request that supplies its own `statement` or `subject` is ignored on those fields.

All data is synthetic. Both sources are simulated in the same deployment by the same operator. They use distinct demo signing keys, but the project does not present them as organizationally independent.

## How the comparison works

The two sources speak different vocabularies: the site declares what it did, the destination reports what it observed. Comparing them uses a declared correspondence relation rather than string equality:

```
SUCCESS_DECLARED ↔ ACTION_PRESENT   corresponds
SUCCESS_DECLARED ↔ ACTION_ABSENT    does not correspond
```

That table is published in every bundle. Four fields are compared — `statement`, `order_id`, `amount_cents`, `currency` — and the verdict is `AGREEMENT` only if every row matches. A statement pair outside the table is reported as `INSUFFICIENT_EVIDENCE` with reason `STATEMENT_NOT_COMPARABLE`, never as a disagreement.

The comparison emits no score, no probability, and no opinion about which source is correct.

## Verify offline

1. Run the live demo and download the evidence bundle, or use `src/downloads/bundle.example.json`.
2. Download `src/downloads/verify.mjs`.
3. Run:

```bash
node verify.mjs ai-evidence-in-action-bundle.json
```

Verification has two independent parts, in the browser and in the offline verifier alike:

- **Integrity** — each record's canonical payload is re-hashed and each Ed25519 signature is checked against the published demo public keys.
- **Comparison consistency** — the verdict is recomputed from the records that actually verified and checked against the verdict recorded in the bundle. A record that fails verification is excluded from the recomputation, so swapping a statement cannot buy a better verdict.

Two deliberately modified examples are included:

- `src/downloads/bundle.tampered.json` — one record field edited. Signature check fails.
- `src/downloads/bundle.verdict-tampered.json` — records untouched, only the recorded verdict edited. Every signature still passes; the recomputation catches it and the status is `COMPARISON_ALTERED`.

The offline verifier establishes only demo-record integrity, signature validity against the published demo keys, and comparison consistency. It does **not** establish that a real-world financial event occurred, real-world identity, trusted time, or source independence.

## What this build does not claim

- It does not prove that any real-world financial event occurred.
- It does not identify a real-world party.
- It does not guess which source is correct.
- Missing evidence is not treated as failure.
- Valid signatures establish record integrity and demo-key attribution, not the truth of what a record says.
- This public challenge format is a standalone demonstration format, not a production evidence contract.

## Run locally

Serve the `src/` directory from a local HTTP server. The signing endpoint at `/api/demo-record` is a Netlify function and needs its signing secret in the environment; without it the endpoint refuses to sign rather than falling back to anything. WebMCP itself requires a supported secure browser context; the page demo remains usable without WebMCP and says so explicitly.

## Tests

```bash
npm run check   # syntax
npm test        # node --test
```

## Challenge status

See [CHALLENGE.md](./CHALLENGE.md) for the challenge-period build record and publication boundary.

## License

MIT — see [LICENSE](./LICENSE).
