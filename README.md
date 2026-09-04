# photoctl

CLI-first photo library and editor for Mac, with a portable core. Import RAW photos into a
library, cull, rate, search, develop, retouch, and export — every verb usable from a shell or by
an agent, with stable JSON output. A GUI, if one ever exists, is a client of the same verbs.

**Status:** pre-alpha. The plan is written; the code is not. Start at
[`specs/photoctl/README.md`](specs/photoctl/README.md) — its "Next Agent Prompt" says where to pick up.

## Conventions

See [`AGENTS.md`](AGENTS.md). Tests are functional and run through the Docker seam; `fixtures/`
holds committed known-good/known-bad assets (see `fixtures/README.md`).

## Running tests, linters, and the closeout gate

Defined by slice 00 of the spec (`bun run verify`, `bun run test`, `scripts/gold-exam.sh`).
This section is filled in when that slice lands.
