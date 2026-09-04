# Drafting brief — photoctl v1 slice plan

You are one of several independent drafters. You will NOT see other drafts. Return your complete plan INLINE as markdown (no files written to the repo). You may read anything on disk.

## Inputs (read all before drafting)
1. `spec-input.md` (this folder) — David's spec + delta, verbatim.
2. `map.html` (this folder) — the completed /explore-unknowns map. Its decision ledger D1–D40 + A′ are GIVENS. Do not re-decide them. Its OPEN items, sharp edges, spec amendments, and 8 integration test cases are inputs to your slices. Read the raw HTML; it is self-contained.
3. `session-sample.html` — what CLI output should look like (JSON envelope, stderr progress, layer list). D27/D28 on the map supersede B3/B4 there.
4. Interview answers (final):
   - First playable checkpoint: `photoctl init` → `import scratchpad/a7c2.ARW --link` → `show` → `export` the ARW's embedded full-size JPEG. Keyless, no Rust, no Swift, no drive. Slice 1 must end with a JPEG a human opens.
   - Repo shape: npm/Bun workspaces monorepo. Precedents to read: `~/dev/duet` (Bun workspaces `apps/*` + `packages/*`, dependency catalog, turbo.json, oxlint/oxfmt, docker-gated checks) and `~/dev/game` (root Cargo workspace with `crates/*` + `packages/*` + `apps/*`, root package.json scripts test:rust/test:web/verify). photoctl needs both halves: TS packages + Rust crate(s) + a small Swift helper. Propose the concrete layout and the root scripts.
   - Migrations: yes (forward-only numbered migrations with an upgrade-a-fixture-library test from the first schema change). Backward compatibility: NO — hard cutovers, no shims.
   - Runtime: Node 24 for the CLI runtime (the map's port cards assume Node); package manager may follow the duet precedent (Bun) if you justify it — state your choice.
5. Code to lift: `~/dev/duet-agent` — src/file-lock.ts, src/memory/pglite.ts, src/memory/session.ts, src/memory/embedding-worker.ts, src/memory/migrations.ts, and tests test/memory-embedding-worker-lock-starvation.test.ts, test/memory-session-concurrent-fresh-open.test.ts, test/memory-pglite.test.ts, evals/memory-multi-cli-lock.eval.ts. The map's Quadrant 4 has 11 port cards. Recon these files yourself (grep, read excerpts) — cite file:line in your plan.
6. Measured artifacts in the parent scratchpad (`..`): `spike/` (lockfile vs pglite-socket race scripts: lock.mjs, cli-lock.mjs, cli-socket.mjs, daemon.mjs, check.mjs), `a7c2.ARW` (real Sony A7C II sample, uncompressed, 7008x4672, embedded JPEGs at 160x120 / 1616x1080 / 7008x4672), `models/` (NAFNet ONNX exports — deferred per D39), `vercel-models.json` (live gateway catalog).
7. Skills the implementer will follow: `.agents/skills/write-tests` (functional tests through the outermost entry point; Docker seam), `.agents/skills/refactor-clean` (no compat wrappers, single owner per concept), `.agents/skills/write-spec` (slice-file contract below). Read write-tests and refactor-clean SKILL.md.

## What to return
1. **Slice graph**: numbered slices (NN-name), each with: contract unlocked; API seam (package/module, functions/types, data shapes, ownership); what the human can run or see (a command, a fixture page, an HTML report); verification (functional tests through `photoctl`, probes, perf gates); delegated decisions (freedoms deliberately left to the implementer) — everything else must be resolved; what must stay green; dependencies on other slices. Every slice must be independently verifiable and useful before the whole feature exists.
2. **Package/app/crate boundaries** and the concrete monorepo layout with root scripts (`test`, `test:rust`, `verify`, etc.), and how the Docker test seam is wired.
3. **API seams** that must have exactly one owner (per refactor-clean): e.g. the render graph, coordinate space, provider interface (gateway adapter × model adapter), decoder interface, locator/identity, JSON envelope, develop dict + tiering table, layer model. Say which slice introduces each and confirm no later slice adds a parallel abstraction. Any transitional scaffolding must name its removal slice.
4. **Playable deliverables** per slice (what is runnable after it lands).
5. **Risks / fog**: which slices hide multiple variables or unknown practice; propose sub-slicing or spikes (e.g. the two with-key smoke tests, the LibRaw vendoring build, the Swift helper headless-under-SSH check, the PGlite TOAST repro).
6. **Human review checkpoints** (non-blocking: open evidence, ~5 min window, decide on evidence if silent).
7. **Scope firewalls**: what v1 explicitly does not touch, per slice.
8. Where the map's OPEN items land (which slice consumes each, and the placeholder used until it's resolved — e.g. a7c2.ARW until the drive; a stub provider returning canned pixels until keys).

Be concrete: greppable names, exact commands, exact JSON shapes where the map already fixed them. Cite measured facts from the map rather than re-deriving. Aim for the plan a fresh agent could start slice 1 from without this conversation.
