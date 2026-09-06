# photoctl

A photo library and editor whose only interface is a CLI. Every verb — import, cull, rate,
search, develop, retouch, reimagine, relight, export — defaults to stable JSON, so an agent can run
the whole workflow without a screen; `--human` renders that same result as text without changing execution.
If a GUI ever exists it is a client of the same verbs, never a superset. Full-frame `reimagine` and
`relight` edits remain removable layers rather than overwriting the source.

Principles that shape everything here:

- **The library is canonical.** PGlite holds the truth; XMP sidecars are written only on
  request, and original image bytes are never modified, regardless of format.
- **Warn, never refuse.** Soft state (a stale layer, an unplugged drive) becomes a warning in
  the output, not a failed command — the caller looked.
- **Generation is a general model plus a prompt; restoration is a specific local solution.**
  Pixels that must be invented go to a gateway; pixels that are determined by the input never do.
- **Unmasked pixels are exact by construction.** Fidelity outside a mask comes from the
  compositor, never from trusting a model.

## Verification policy

GitHub CI is a fast feedback gate: lint, typechecking and a small, explicit smoke-test
subset. It does not run the entire suite on every push. The full suite belongs in local
development and deliberate release verification; a green GitHub check is not full-feature
or release acceptance. Keep the full local checks intact when changing the CI subset.

Use focused tests while iterating, then run the full local gate at implementation closeout.
Do not optimize product code or relax product performance requirements merely to fit a
hosted runner. Root `package.json` owns the commands and explicit `test:ci` subset;
`.github/workflows/ci.yml` owns the hosted gates. This policy is explicit user direction,
not a temporary CI workaround.

## Where things live

- [`specs/photoctl/`](specs/photoctl/README.md) — the plan and its decision ledger. Its "Next
  Agent Prompt" is the current status and pickup point.
- [`AGENTS.md`](AGENTS.md) — conventions for working in this repo.
- [`fixtures/`](fixtures/README.md) — committed known-good and known-bad assets, each with the
  fact it proves.
- Root `package.json` scripts are the inventory of build, test, and release commands.
- [Native CPU runtime acquisition](crates/photoctl-image/ort/README.md) explains the
  pinned source build, required tools, cache ownership, and platform limits.
