# AI Evidence in Action

AI Evidence in Action is a WebMCP Challenge project showing a simple evidence pattern for AI actions on the web: record what the site reports, check a second simulated source, compare the records, and state only what the available evidence supports.

**The system reporting an action should not have to be the only source of evidence about whether that action occurred.**

## Live demo

https://ai-evidence-in-action.netlify.app/

## Current WebMCP tools

| Tool | Purpose |
| --- | --- |
| `request_refund` | Creates a fixed synthetic $64 refund claim for demo order `ORD-1042`. Performs no real financial action. |
| `get_evidence` | Reads evidence from the site or simulated destination source. |
| `compare_evidence` | Returns `AGREEMENT`, `DISAGREEMENT`, or `INSUFFICIENT_EVIDENCE` with field-level differences. |
| `verify_evidence` | Recomputes SHA-256 commitments and checks Ed25519 signatures against published demo public keys. |

The implementation uses the imperative WebMCP surface on `document.modelContext`, with `AbortSignal` registration lifecycles and the currently specified read-only/untrusted-content annotations.

## Demo scenario

The challenge uses synthetic order `ORD-1042` for **$64.00**. The site declares the synthetic refund successful. The simulated destination then reports no matching action. The comparison returns `DISAGREEMENT`.

All data is synthetic. Both sources are part of the same demonstration deployment. They use distinct demo signing keys, but the project does not present them as organizationally independent.

## Verify offline

1. Run the live demo and download the evidence bundle, or use `src/downloads/bundle.example.json`.
2. Download `src/downloads/verify.mjs`.
3. Run:

```bash
node verify.mjs ai-evidence-in-action-bundle.json
```

A deliberately modified example is included as `src/downloads/bundle.tampered.json`; the verifier must reject it.

The offline verifier establishes only demo-record integrity, signature validity against the published demo keys, and deterministic comparison consistency. It does **not** establish that a real-world financial event occurred, real-world identity, trusted time, or source independence.

## What this build does not claim

- It does not prove that any real-world financial event occurred.
- It does not identify a real-world party.
- It does not guess which source is correct.
- Missing evidence is not treated as failure.
- This public challenge format is a standalone demonstration format, not a production evidence contract.

## Run locally

Serve the `src/` directory from a local HTTP server. WebMCP itself requires a supported secure browser context; the page demo remains usable without WebMCP.

## Challenge status

See [CHALLENGE.md](./CHALLENGE.md) for the challenge-period build record and publication boundary.

## License

MIT — see [LICENSE](./LICENSE).
