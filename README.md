# AI Evidence in Action

AI Evidence in Action is a WebMCP Challenge project showing a simple evidence pattern for AI actions on the web: record what the site reports, check a second simulated source, compare the records, and state only what the available evidence supports.

**The system reporting an action should not have to be the only source of evidence about whether that action occurred.**

## Live demo

Planned challenge URL: https://ai-evidence-in-action.netlify.app/

The public deployment is being connected and tested. Until the live build is verified, this repository is the source of truth for implementation progress.

## Current WebMCP tools

| Tool | Purpose |
| --- | --- |
| `request_refund` | Creates a synthetic refund claim in demo state. Performs no real financial action. |
| `get_evidence` | Reads evidence from the site or simulated destination source. |
| `compare_evidence` | Returns `AGREEMENT`, `DISAGREEMENT`, or `INSUFFICIENT_EVIDENCE` with field-level differences. |
| `verify_evidence` | Reports the integrity state of the current demo bundle. Cryptographic signing is not yet claimed in the initial build. |

The implementation uses the current imperative WebMCP surface: `document.modelContext.registerTool(...)`, with `AbortSignal` registration lifecycles and only the currently specified annotations.

## Demo scenario

The challenge uses synthetic order `ORD-1042` for **$64.00**. The site declares the synthetic refund successful. The simulated destination then reports no matching action. The comparison therefore returns `DISAGREEMENT`.

All data is synthetic. The destination source is simulated and is part of this demonstration environment; it is not presented as an independent financial institution.

## What this build does not claim

- It does not prove that any real-world financial event occurred.
- It does not identify a real-world party.
- It does not guess which source is correct.
- Missing evidence is not treated as failure.
- This public challenge format is a standalone demonstration format, not a production evidence contract.

## Run locally

Serve the `src/` directory from a local HTTP server. WebMCP itself requires a supported secure browser context; the manual scripted demo remains usable without WebMCP.

## Challenge status

See [CHALLENGE.md](./CHALLENGE.md) for the challenge-period build record and publication boundary.

## License

MIT — see [LICENSE](./LICENSE).
