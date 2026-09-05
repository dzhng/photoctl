# photoctl

A photo library and editor whose only interface is a CLI. Every verb — import, cull, rate,
search, develop, retouch, reimagine, export — defaults to stable JSON, so an agent can run the whole
workflow without a screen; `--human` renders that same result as text without changing execution.
If a GUI ever exists it is a client of the same verbs, never a superset.

Principles that shape everything here:

- **The library is canonical.** PGlite holds the truth; XMP sidecars are written only on
  request, and original image bytes are never modified, regardless of format.
- **Warn, never refuse.** Soft state (a stale layer, an unplugged drive) becomes a warning in
  the output, not a failed command — the caller looked.
- **Generation is a general model plus a prompt; restoration is a specific local solution.**
  Pixels that must be invented go to a gateway; pixels that are determined by the input never do.
- **Unmasked pixels are exact by construction.** Fidelity outside a mask comes from the
  compositor, never from trusting a model.

## Where things live

- [`specs/photoctl/`](specs/photoctl/README.md) — the plan and its decision ledger. Its "Next
  Agent Prompt" is the current status and pickup point.
- [`AGENTS.md`](AGENTS.md) — conventions for working in this repo.
- [`fixtures/`](fixtures/README.md) — committed known-good and known-bad assets, each with the
  fact it proves.
- Root `package.json` scripts are the inventory of build, test, and release commands.
