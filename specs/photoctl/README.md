# photoctl v1 — build ladder

CLI-first photo library + editor for Mac (portable core). TypeScript on Node 24, PGlite, a Rust
napi addon, a Swift Core Image helper, Vercel AI Gateway plus explicitly configured image-processing
adapters. Audience: professional photographers
(shoot → cull → rate → deliver); agents drive it one-shot from a chat loop.

This folder is the plan. `visualizations/map.html` holds the original decision ledger (D1–D40 + A′), and
`choices.md` carries later implementation and architecture decisions this plan implements;
`assets/spec-input.md` is David's original spec + delta. Where the map's kickoff
prompt, open-questions list, or the session sample disagree with this README, **this README wins**
(see "Supersedes").

## Next Agent Prompt

*Last updated: 2026-09-05. Status: slices 00–07, render-DAG slices 08a1–08b, and provider-contract slice 09a are
implemented.
Commands share one persistent daemon library handle with an exact-row contention verdict; the CIRAW seam produces
deterministic linear Rec.2020 pixels on macOS, the portable LibRaw seam produces AHD camera-space pixels,
the shared Rust front produces profiled linear Rec.2020 TIFFs within the G4 oracle tolerance, and
recursive import commits through a bounded deterministic pipeline, collision buckets promote to full hashes,
and culling/list/next/remove remain usable from pinned previews while source volumes are offline. Immutable photo-scoped logical
nodes, atomic document revisions, full hash identities, canonical artifact publication, graph evaluation/inspection, and
restore-time artifact reconciliation are now in place. Gateway and independent upscaler contracts now resolve fixed models,
require explicit provider consent, and attach bounded external-execution provenance to the existing DAG execution record. Delivery
exports snapshot that immutable identity, encode the canonical evaluated artifact without unasked clobbering, and record successful
writes in schema v6. Explicit XMP writes now merge catalog cull metadata into sidecars without touching originals or foreign
metadata; pull sync and mtime divergence reporting share that owner. Opened-file snapshots and a strong pre-publication identity
check followed by atomic displacement and no-clobber installation keep external editors from pairing old XML with new metadata or
silently losing an observed edit. Develop dictionaries and package/library presets now live in typed immutable nodes with full
hashes; pixel operators remain in 08c+.*

You are resuming photoctl. Read this README top to bottom, then open the slice file for the pickup
point and follow it exactly. Do not re-decide anything in the original decision ledger (`visualizations/map.html`
Quadrant 2), the later ledger (`choices.md`), in "Contracts", or in "Global rules"; if the code forces a deviation, append it to
"Implementation notes" (plan said / code revealed / call made / needs David?) and keep going.

- **Pickup point:** slice 08c1 (global develop pixel operators).
  Slice 08c1 inherits 08b's canonical dictionary, preset precedence, typed immutable develop node, lazy logical graph, durable
  artifact owner, and execution metadata seam.
- **Blockers:** G3's SSH-only CIRAW exam needs Remote Login enabled; normal host decode is green and this
  does not block deterministic work. With-key work (09b smoke, 12 pre-gate) waits on David's Gateway key;
  the real-drive gold exam (14) waits on the drive path; SAM weight hosting (11a) waits on a release URL.
  The first live upscaler/model and its balanced control values remain evidence-selected in 09b/13a; absent
  credentials leave the adapter unconfigured and do not block the fake-adapter contracts.
  None blocks deterministic work — placeholders are named per slice.
- **Before ending your pass:** update this section, tick the TODO, run the closeout gate named by the slice.

### Global TODO
- [x] 00 repo skeleton, Docker seam, `protocol` + `commands`, `photoctl --version`, fixture manifest tool — `slices/00-repo-skeleton.md`
- [x] 01a library open, ONE lock, refuse-to-open, `init`, `doctor` — `slices/01-first-jpeg.md`
- [x] 01b universal image source → show → offline preview → export (A7C II embedded-container proof) — `slices/01-first-jpeg.md`
- [x] 02a daemon (runs `dispatch`), contention race, `tag` — `slices/02-daemon-and-contention.md`
- [x] 02b global `--human` envelope renderer — `slices/02-daemon-and-contention.md`
- [x] 03a preview coordination/index/prune · [x] 03b backup/restore/migrate + fixture — `slices/03-library-lifecycle.md`
- [x] 04 import at scale, locators/offline, cull verbs, XMP read — `slices/04-import-and-cull.md`
- [x] 05 delivery export + `scripts/gold-exam.sh` (keyless dry run) — `slices/05-delivery-export.md`
- [x] 06 xmp write / sync — `slices/06-xmp-write-sync.md`
- [x] 07a CIRAW helper + shared decoder seam · 07b LibRaw · 07c decoder oracle/color front — `slices/07-decoders.md`
- [ ] 08 immutable render DAG: [x] 8a1 logical graph/revisions/full hashes · [x] 8a2 artifacts/evaluator/inspection · [x] 8b develop dict/presets/node · [ ] 8c+ color/local ops/geometry → **gold exam green** — `slices/08-develop.md`
- [ ] 09 providers: [x] 9a gateway contracts + dedicated upscaler adapter · [ ] 9b non-blocking spikes · [ ] 9c embed worker + search — `slices/09-providers-embed-search.md`
- [ ] 10 DAG-backed layers, transforms, composite, vacancy, A′ — `slices/10-layers-and-composite.md`
- [ ] 11 segment: 11a SAM runtime, 11b verbs — `slices/11-segment.md`
- [ ] 12 fill DAG, optional density-matching upscale, strict composite, person-move flow — `slices/12-fill.md`
- [ ] 13a reimagine/relight/generate + upscaler quality spike · 13b auto_enhance · 13c markup · 13d retouch — `slices/13-generative-extras-and-markup.md`
- [ ] 14 real-drive gold exam + packed-install release gate — `slices/14-gold-exam-and-release.md`
- [ ] 15 (optional, unspecified until real) MCP — `slices/15-mcp.md`

## Goal and closeout gate

**Gold exam (must pass, keyless):** with `photoctl` on PATH on David's Mac: import a folder of A7C II
ARWs from the external drive `--link` → `list` → `rate` 10 → `develop` 3 with `--preset people` →
`export` JPEGs a photographer would deliver. No GUI, no gateway key. `scripts/gold-exam.sh` (owned by
slice 05) is the single implementation; it runs on `fixtures:drive` output in tests from 08 and on the
real drive in 14.

## Slice graph

```
00 ─ 01a ─ 01b ─ 02a ─ 03a ─ 03b ─ 04 ─ 05 ─ 06
                      └─ 02b
          └─ 07 (7a → 7b → 7c) ─ 08a DAG ─ 08b+ develop ★gold ────────────── 14 ─ 15
                                             ├─ 09 providers (also needs 04) ─┐
                                             └─ 10 layers ─ 11 segment ──────┴─ 12 fill ─ 13a/b
                                                          └──────────────────── 13c markup / 13d retouch
```

## Precedent repos — where to look before designing anything

David's sibling repos have already solved most of the infrastructure here. **Look first, lift and
cite, then adapt** — never re-derive. Each row names the pattern, the source, and the mistake found
there that photoctl must not repeat (details on the map's Quadrant 4 cards).

| Pattern | Precedent | Lift from | Do not repeat |
|---|---|---|---|
| Bun workspaces + dependency catalog, turbo, oxlint/oxfmt, `bunfig.toml`, `typescript-config`, docker-gated checks | `~/dev/duet` | `package.json`, `turbo.json`, `bunfig.toml`, `.oxlintrc.json`, `packages/typescript-config/`, `scripts/` | Bun as the *runtime* — here Node executes all project code |
| Root Cargo workspace beside TS packages; thin root scripts spanning both (`test:rust`, `test:web`, `verify`); `throwaway/` + `dbg*` test buckets | `~/dev/game` | `Cargo.toml`, `package.json`, `.gitignore` | — |
| PGlite single-writer lock, session lifetime, refuse-vs-recover, migrations runner | `~/dev/duet-agent` | `src/file-lock.ts`, `src/memory/pglite.ts`, `src/memory/session.ts`, `src/memory/migrations.ts` | two lock models with opposite staleness rules; `EPERM` treated as alive; no SIGINT/SIGTERM handler; lock leaked on a throwing open; `withDb` returning `undefined` on timeout (silent write drop); auto-quarantine that starts an empty library; `cpSync` assumed to clone; `@electric-sql/pglite/vector` import (gone in 0.5.x); seven-step migration churn; `storage.ts` dragging in the whole agent runtime |
| Background embedding worker that yields the lock between batches | `~/dev/duet-agent` | `src/memory/embedding-worker.ts` | yield/poll constants tuned independently (the code admits the pairing is unsound); Bun-derived timing budgets |
| Hybrid retrieval: tsvector + vector fused with RRF | `~/dev/duet-agent` | `src/memory/recall.ts` | vector(3072) without an index — use `halfvec` + HNSW |
| Functional tests through the real CLI as real OS processes; the Docker seam | `~/dev/duet-agent` | `test/memory-embedding-worker-lock-starvation.test.ts`, `test/memory-session-concurrent-fresh-open.test.ts`, `test/memory-pglite.test.ts`, `evals/memory-multi-cli-lock.eval.ts`, `test/helpers/docker-only.ts`, `package.json` `test` script | env-gated skips (`testIfDocker`) that leave CI green with zero assertions; workers spawned with `bun` importing `.ts` (Node won't remap `./x.js` → `.ts`); `PEER_LOCK_BUDGET_MS` derived from Bun's spawn time |
| CI on every push; tag-based release (`v*` → GitHub Release + npm publish) | `~/dev/duet-agent` | `.github/workflows/{ci,publish}.yml` (already lifted) | — |
| `AGENTS.md` / `CLAUDE.md` conventions | `~/dev/duet` | copied verbatim, then only deletions | paraphrasing or restructuring it |

## Repo shape (decided)

Bun 1.3.x is the package manager, workspace/catalog resolver, script runner and Turbo launcher (the
`~/dev/duet` precedent). **Node 24 executes all project code** — CLI, daemon, tests, spawned workers;
`bun` never runs a `.ts` of ours. Rust is a root Cargo workspace (the `~/dev/game` precedent).

```
photoctl/
  package.json  turbo.json  bunfig.toml  Cargo.toml  .oxlintrc.json  .oxfmtrc.json
  apps/
    cli/              bin photoctl → dist/bin.js: argv → commands.dispatch → stdout/stderr. No domain logic.
    daemon/           socket server that RUNS commands.dispatch + background workers (embed, model cache).
    workbench/        dev-only `wb`: one HTML report per slice into out/wb/ (never shipped).
    mcp/              slice 15 only.
  packages/
    protocol/         LEAF. Envelope, closed ErrorCode + WarningCode unions, exit mapping, stderr events, per-verb Zod shapes, CommandRequest.
    commands/         dispatcher + verb handlers + daemon client (socket path, ensureDaemon). Imports the domain packages.
    library/          PGlite open/lock/session, migrations, metadata-only backup (pgDump), identity, locators, settings, xmp, search fusion.
    importer/         scan, content-based image probe registry, EXIF (timezone owner), embedded-preview index, cache tiers/index/prune.
    render/           typed immutable render DAG/evaluator, artifact publication, coordinates, develop dict + operator/tier tables, layers, transforms, fill pipeline, markup, export planning.
    providers/        gateway adapter, image/structured adapters, dedicated UpscaleAdapter registry, fixed model table, versioned prompts.
    img/              napi loader for crates/photoctl-image; per-platform packages.
    mac-helper/       npm wrapper + darwin packages shipping the Swift helper binary.
    test-harness/     spawnPhotoctl (built JS only), withLibrary, fake gateway server, hold-lock helper, manifest reader.
    typescript-config/
  crates/
    libraw-sys/       vendored LibRaw 0.22.2 (CDDL-1.0), --disable-openmp, libc++ dynamic.
    photoctl-image/   napi: decode, develop core (levels→WB→matrix→ops→TRC), delta kernels, masks, resample, composite, SAM (ort CPU), heal, draw.
  helpers/mac/        SwiftPM "photoctl-mac": CIRAWFilter decode + Vision horizon. No AppKit.
  fixtures/           committed known-good/bad assets + README manifest; fixtures/tools/ independent manifest generator
  test/               Dockerfile, compose.yaml (functional + gateway-fixture services)
  scripts/            gold-exam.sh, install-clean.sh, export-sam2.py
```

Root scripts (bare = whole job, `:suffix` = one part):

```
build            build:ts (turbo) && build:rust (napi) && build:swift (no-op off Mac)
test             test:ts && test:rust && test:functional && test:macos
test:functional  docker compose -f test/compose.yaml run --rm functional   ← THE gate; fails visibly if Docker/fixtures/weights missing or zero tests ran
test:macos       host-only vitest project (CIRAW helper, hdiutil volume, Trash, perf bands)
test:rust        cargo test --workspace
lint / typecheck / fmt / fmt:check
verify           fmt:check && lint && typecheck && build && test
wb               node apps/workbench/dist/cli.js
fixtures:drive   N padded copies of a7c2.ARW + Classic-style sidecars       fixtures:volume  hdiutil image (Mac)
probe:*          keyless, machine-specific: race, headless-ciraw, toast     smoke:*  with-key: mask-polarity, embed-shape
pack             tarballs for apps/cli, packages/img-*, packages/mac-helper-*
publish:npm      used by .github/workflows/publish.yml on v* tags; release = `npm version <bump> && git push --follow-tags`
```

## Global rules every slice inherits

- **Batch verbs:** `rate flag label tag develop export xmp remove embed` accept `<id...>` and return
  per-item `results` (D6/D10). Single-target verbs (`segment fill retouch layer markup`) take one id.
- **Warn, never refuse** on soft state — `warnings[]` with a `WarningCode`, exit 0 (D28).
- **No runtime capability discovery** — model IDs are a fixed table; gateway `modalities` fields are never read (D25).
  Upscaling uses a separate `UpscaleAdapter` registry: the release pins a generative default, a library may override it,
  and `--upscale-model` wins per command. `generation.upscale` is `auto|off` (default `auto`), but `auto` runs only
  after that adapter is explicitly configured; ambient credentials are not consent to send pixels to another vendor.
- **Coordinates** are oriented, uncropped, top-left base pixels; `bbox = [x,y,w,h]`; crop/straighten apply
  last; adapters convert external frames once and never leak them (D13). `--norm` (0..1) accepted wherever coordinates are (from 10).
- **Two buckets:** generation = SOTA general model + versioned prompt; restoration/geometry = specific local solution (D26).
  Resolution matching of generated pixels is a generative processing node, not ordinary restoration or resampling.
- **CoreML EP** is a constraint, not a plan item: no slice enables it in v1; if ever enabled it must be per
  model, static shapes, ≥2× measured, output-equivalent within tolerance; CPU is the reference (D40).
- **Never write original image bytes, regardless of format; never write into source folders except
  explicit `xmp write`, which writes or merges a sidecar only** (D19).
- **Every library photo has an offline preview:** a successful import leaves a pinned,
  source-independent 1616-tier JPEG plus its `cache_index` row.
  Re-import repairs either half if it is missing or corrupt. A `photos` row without that preview is not
  a successful import state; `files.embedded` remains reserved for genuine embedded JPEG byte ranges.
- **Source and rendered previews are distinct:** the pinned import preview is immutable fallback input.
  The current edited preview is a derived, prunable JPEG keyed by the canonical `render_hash`. Pixel-affecting
  mutations change render state but do not synchronously render a preview. The next `show <id>` lazily and
  atomically materializes the requested view before returning its absolute path in `data.preview`; with no
  edits and the default overview it may return the pinned source-preview path directly.
- **One full-frame render feeds detail views:** preview owns a prunable, full-frame display master at
  `view/<id>/<render_hash>/master.jpg`, materialized lazily at the best available source resolution. A native
  full-frame `show` returns that master; later crops and smaller views at the same `render_hash` are pixel
  projections of it and must not reevaluate the edit graph. Before creating the master, the planner may use an
  existing full-frame view only when its real pixel density covers the requested crop/output; otherwise it
  promotes once to the master. The default 1616 overview remains cheap and does not force a full-resolution
  render. Any pixel edit creates a new `render_hash`, so it can never reuse a master containing old edits.
- **Preview materialization is single-flight and inspection-safe:** concurrent requests that need the same
  `{photo_id,render_hash,artifact}` join one materialization; only one graph evaluation or view derivation runs,
  every waiter receives the same validated artifact, and a failed attempt clears the flight so a later request can
  retry. `show` updates `cache_index.last_used` only after the returned file is readable. `cache prune` must not
  remove an in-flight artifact or one returned within the preceding 30 minutes, so an agent can inspect and compare
  paths without a concurrent prune invalidating them.
- **Preview viewport is explicit:** `show <id> [--preview-size <long-edge-px|native>]
  [--region x,y,w,h] [--norm]` renders the current `render_hash` for a canonical `ViewSpec`. With no region,
  size defaults to a 1616px-long-edge overview. With a region and no size, it defaults to `native`: one output
  pixel per oriented base-image pixel. A region view is rendered from the best full-resolution source and
  current graph before cropping/downscaling; it must never enlarge the 1616px source preview and call that
  full-resolution detail. `data.preview_info` reports requested/actual region, dimensions, source tier,
  pixel scale, `render_hash`, `view_hash`, and whether resolution was limited. It also reports `base_to_view`,
  `view_to_base`, and the visible base-image polygon so UI clicks and agent-selected regions share the global
  oriented, uncropped coordinate system even after crop/rotate/straighten. A fully non-visible region is a usage
  error; a partially visible region is clipped and reported as such rather than silently moved.
- **Preview color is fixed:** every source preview, display master, and derived view is an orientation-applied,
  opaque JPEG tagged with the bundled `sRGB2014.icc`; `preview_info` reports `color_space:"srgb"` and
  `icc:"sRGB2014"`. Export may use a different requested format/profile, but inspection never depends on an
  application guessing the preview profile.
- **Image imports are capability-based, not extension-gated:** `import --link` and `import --copy` accept
  every decodable single-frame still image by probing file contents. Once imported, every photo is
  eligible for the same catalog, metadata, culling, develop, search, layer, segmentation, editing,
  preview, offline, and export verbs. Format selects only the source adapter and lossless-copy
  optimizations; it never changes command availability or result shapes. Extensions are filename hints only;
  an unknown or incorrect extension is not a refusal. Corrupt bytes, animated/multipage media, and formats
  for which no registered preview producer can decode or extract a full-frame image return
  `unsupported_file`/`skipped_unsupported` and create no `photos` row.
- **One resampler:** every pixel-space resample (layers, provider normalize, SAM letterbox) is
  `photoctl-image::resample`; **sharp** does encode/ICC/XMP/EXIF + the final delivery downscale only. An
  `UpscaleAdapter` synthesizes pixels and therefore is not a second resampler; its result passes through the one
  deterministic resampler at most once to reach exact base geometry.
- **One immutable image DAG:** source, develop, generate, upscale, transform, mask, composite, crop, markup, and
  output are typed nodes. User-visible layers are ordered roots into that graph, not containers for private replay
  pipelines. Nodes and ordered edges are relational; typed parameters are canonical JSON. A mutation inserts nodes
  and a document revision rather than editing a node in place.
- **Identity and publication:** canonical recipe, execution, artifact, render, and view hashes retain the full
  SHA-256 value; only `--human` abbreviates them. Deterministic nodes reuse by recipe and input-artifact hashes;
  nondeterministic nodes also have an execution id and output-artifact hash. Canonical content-addressed artifacts
  publish and fsync before the graph transaction redirects a root; a crash may leave an orphan, never an active
  node with missing pixels.
- **Graph retention:** active layer/output roots, bounded undo revisions, and explicitly pinned snapshots keep
  nodes reachable. Reachability GC may collect canonical pixel artifacts after a grace period while retaining
  lightweight provenance with `artifact_available:false`; cache pruning remains a separate lifecycle. The numeric
  undo/age/storage limit stays OPEN until representative artifact sizes are measured, so no automatic canonical-
  artifact deletion lands before that measurement.
- **Backup scope:** automatic/manual `backup` remains a metadata-only PGlite recovery snapshot. Once canonical
  artifacts exist, `restore` replaces database state while preserving `artifacts/`, originals, and cache directories;
  it does not claim to recover artifact files already lost outside PGlite.
- **Determinism:** no float atomics, fixed rayon chunking; the same dict + decoder → byte-identical 16-bit output.
- **Migrations** are numbered at land time ("next number"); each schema slice adds `fixtures/libraries/schema-vN.pgsql`
  and extends `migrate-upgrade.test.ts`. Columns exist only when a verb writes them.

## Testing rules (from `/write-tests`, D38)

- Functional tests drive the **built** CLI (`node apps/cli/dist/bin.js`) as real OS processes against
  real PGlite data dirs inside `test:functional`. No env-gated skips: the compose command *is* the seam.
  The harness fails the run when zero tests executed (permanent self-test).
- External edges only are substituted: a real-HTTP **fake gateway** service speaking the four
  OpenAI-compatible routes photoctl uses (`chat/completions` with `response_format:json_schema`,
  `embeddings`, `images/edits`, `images/generations`), and the volume/mount edge
  (`PHOTOCTL_VOLUME_MAP=/dir=UUID:online|offline`). `PHOTOCTL_NO_DAEMON=1` makes the harness run a suite in-process.
- Timing budgets are injectable via env and derived from measured Node spawn time in the harness.
- Fixture facts live in `fixtures/README.md` + `fixtures/a7c2.json`, produced by `fixtures/tools/` —
  independent of the code under test — so identity/embedded tests cannot be tautologies.
- Unit tests only for pure logic; visual output goes through `screenshot-critique`, and `compare-screenshots` when a reference exists.

## Contracts (single owners — refactor-clean)

| Concept | Sole owner | Slice |
|---|---|---|
| Envelope, closed `ErrorCode` + `WarningCode`, `exitCodeFor`, stderr events, `CommandRequest`, per-verb Zod shapes | `packages/protocol` (leaf) | 00 |
| Command dispatcher + verb handlers; daemon client (`socketPath`, `ensureDaemon`) | `packages/commands` | 00/02 |
| Library handle, ONE lock (`{pid,socket,startedAt}`), refuse-to-open, `settings` (only per-library config), migrations, pgDump backup/restore | `packages/library` | 01a/03 |
| Identity (content key), locators (`files` 1:N), volume/online, Trash | `packages/library/{identity,locators,trash}` | 01b/04 |
| Content-based image probe registry; EXIF + timezone; embedded-preview index; cache tiers + index + prune | `packages/importer` | 01b/03 |
| Generic `ImageSource`; decoder interface + `LinearImage{space}`; source/decoder selection | `packages/render/decoder` | 01b/07 |
| Color core (levels→WB→matrix→ops→TRC), delta kernels, NR | `crates/photoctl-image::develop` | 07c/08/10 |
| Immutable image DAG types/evaluator, ordered edges, node recipes, document revisions, reachability, graph inspection | `packages/render/graph` | 08a |
| Canonical artifact publication/index (paid state, never preview cache) | `packages/render/artifacts`; PGlite tables in `packages/library` migrations | 08a |
| Canonical `render_hash` + `ViewSpec`; single-flight full-frame display master, cache leases, coordinate transforms, color, and versioned view paths | `packages/render/preview` | 01b/03/08/10/13 |
| Coordinate space (`toBase/fromBase`, bbox, letterbox mapping) | `packages/render/coordinates` | 01b |
| Develop dict, hash, presets (package data + `<lib>/presets/develop/`), **operator table**, **tier table** | `packages/render/develop` | 08 |
| Export planning (template, collision, IPTC-as-XMP/EXIF, presets `<lib>/presets/export/`, history); sharp encode | `packages/render/export` | 01b/05 |
| `scripts/gold-exam.sh` | scripts | 05 |
| XMP read / explicit write (parse-merge) / sync / stale | `packages/library/xmp` | 04/06 |
| Gateway adapter; `ImageModelAdapter` + `StructuredModelAdapter`; external-boundary `UpscaleAdapter`; fixed model table; adapter registry; versioned prompts; cost table | `packages/providers` | 09a |
| Embed worker; RRF search | `apps/daemon/src/workers/embed.ts`; `packages/library/search` | 09c |
| User-facing layer stack and output-node roots (roles subject/vacancy/reimagine/retouch), transforms (S→R→T matrix once) | `packages/render/{layers,transforms}` | 10 |
| Fill DAG planning (mask fit, crop policy, generation, optional upscale/density plan, exact composite) | `packages/render/fill` | 12 |
| Masks, resample, composite, lift, SAM, heal, draw | `crates/photoctl-image` | 10–13 |
| Markup model + flatten | `packages/render/markup` | 13c |
| Fixture manifest + generator | `fixtures/README.md`, `fixtures/a7c2.json`, `fixtures/tools/` | 00 |

**Transitional seams (each named with its end):** (1) 08a1 removed 01b's public linear `renderPhoto` state owner and
hard-cut render/view protocol and path identities to full SHA-256 values; there is no compatibility alias. 08a2 wired the
graph evaluator into the existing preview coordinator. The private source decoder bridge, source resolution, and pinned-preview
fallback remain permanent; 8b+ supplies pixel evaluators for the remaining node kinds.
(2) 05's gold-exam
dry run omits `develop`; 08 adds it to the script — no stub verb exists. (3) 08's `develop` result carries
empty `layers:{delta_applied:[],stale:[]}` until 10 fills it — shape fixed, no rewrite. Nothing else is
temporary; the fake gateway, volume map and hold-lock helper are permanent test edges.

## Envelope

Session-sample A4/A6 (accepted by David) is the contract: `results`/`summary` at the top level.

```json
{"schema":1,"ok":true,"data":{...},"warnings":[{"code":"source_offline","id":"…","message":"…"}]}
{"schema":1,"ok":false,"code":"library_locked","data":{"holder_pid":48990,"waited_ms":30000}}
{"schema":1,"ok":false,"code":"partial","summary":{"ok":2,"failed":1},"results":[{"id":"…","ok":true},{"id":"…","ok":false,"code":"not_found"}]}
```

Exit classes: 0 ok · 2 usage · 65 data · 69 unavailable (don't retry) · 75 temporary (retry). The
per-code mapping is `protocol.exitCodeFor` (slice 00) — the only place it is written down.

**Offline behavior:** every catalogued photo remains viewable from its pinned 1616 tier when all source
locators are offline. Export fallback precedence = develop render with matching hash > cached full-size
tier > pinned 1616 tier; any of them → write + `source_offline` warning, exit 0. `file_offline` 69 is
reserved for source-dependent work when the required cached artifact is missing or corrupt; ordinary
preview availability is an import invariant, not a best-effort cache hit.

**Agent preview/export flow:** `show <id>` is the synchronization point for visual inspection: it must
return only after `data.preview` names a readable absolute JPEG for the current `render_hash` and requested
`ViewSpec`. Editing
commands may return immediately after committing a document revision and its active DAG roots; the agent then calls `show`, views that
path, and decides whether to edit again or `export`. Export renders at the requested output tier from the
same `render_hash` and includes it in the result, so preview and export cannot silently refer to different
edit states. Preview pixels are review-sized, not the export source of truth.

`layer list/show` remain the ordinary editing surface. `graph show <id> [--layer L] [--history] [--limit N]
[--cursor C]` exposes a bounded page of reachable nodes and `graph node <id> <node>` returns one bounded
provenance record. The daemon's 16 MiB frame ceiling never grows to accommodate unbounded history.

The mandatory functional journey is: **make an overall edit → request and inspect the full-frame native
preview → zoom into a native-resolution detail cropped from that cached master → make a local edit → inspect
the same detail from the new render state's master → adjust it → inspect the updated detail → inspect the
final zoomed-out view derived from that final master → export**. Slice 12 owns the deterministic end-to-end test;
individual editing slices extend its mutation matrix rather than substituting isolated command tests.

Lossless/random-access master storage and progressive, cancellable UI delivery are deliberately deferred to
[`../preview-rendering-optimizations.md`](../preview-rendering-optimizations.md); they must preserve this `show`
contract rather than introduce a second rendering model.

## Spec amendments carried from the map

Sidecars only, explicit `xmp write` (D19) · drop `--json`, JSON default (D10) · OpenColorIO grading math
instead of "port darktable/ART" · LibRaw is LGPL-2.1 OR CDDL-1.0, take CDDL · Vercel only for v1 behind a
gateway adapter for its four OpenAI-compatible routes (D25), while purpose-built upscalers use an explicitly
configured external `UpscaleAdapter` boundary · `copy_edits_from` → `develop --copy-from` · `unblur` cut (D35); `relight` = prompt
template with `drift:"full-frame"`; `--strength` = feather (documented, not A1111 denoise). **Verbs added
vs the input spec** (the inventory itself is `packages/protocol/src/verbs/`): `flag label next remove
layer(list|show|transform|reorder|set|duplicate|remove|clear|refresh) xmp(write|sync) cache prune backup restore
migrate daemon(start|stop|status) embed decode render presets(show) search graph(show|node)`; `export --resize --template
--on-collision --iptc --preset`; `segment --text --dry-run`; `fill --move --to|--by`; `--relative`;
`--upscale|--no-upscale|--upscale-model`; `--no-daemon`; `--stream`; `doctor --fetch-models`.

## Known unknowns (OPEN on the map) and where they land

| OPEN | Slice | Placeholder |
|---|---|---|
| ARW drive path | 14 (04 uses it if present) | `fixtures:drive` + `fixtures:volume` |
| Gateway key + per-verb model IDs | 09a (`doctor`, `settings`); 12 | fake gateway; `provider_unconfigured` |
| First live upscaler adapter/model + balanced creativity/resemblance values | 09b/13a | deterministic fake adapter; `upscale_unconfigured`; live spike runs only when explicitly configured credentials exist |
| Canonical provider/upscale artifact encoding | 08a/09b | lossless fake-adapter artifact; choose after PNG-vs-working-format size/round-trip measurement |
| Undo artifact count/age/storage limit | 08a measurement, then 10 | roots/reachability land; automatic canonical-artifact GC remains off until measured |
| Smoke 1 mask polarity | 12 pre-gate | adapters `maskPolarity:"unverified"` → live native-mask fill refused (`provider_unverified_mask` 69) |
| Smoke 2 multimodal embedding shape | 09b | fake gateway vectors; real mode stays manual |
| Lossless-L tag 6/7, M/S pseudo-RAW | 07b probe; 14 fixtures | uncompressed a7c2 only |
| PGlite TOAST on wide vectors | 09b, gates 09c | append-only writes if reproduced |
| SAM 2.1 ONNX hosting URL | 11a | export script committed; download URL `settings.models_base_url` |
| Founder checklist (Classic masters + XMP) | 04/14 | hand-authored Classic-style sidecars in `fixtures/xmp/` |

## Human review checkpoints (non-blocking)

Open evidence with `preview-shots`, name the ONE variable judged, and use `compare-screenshots` whenever a
prior/reference image exists. Every visual slice runs an unprimed `screenshot-critique` as its last acceptance
check. Wait ~5 min, decide on evidence if silent, record the call in the slice file, close windows. One variable
per checkpoint; listed per slice.

## Drafts and rulings (scrollback audit)

Four blind drafts (`assets/drafts/`: Claude A fewest-slices, B risk-first, D feedback-loop; Codex C
seam-quality) were synthesized, then two audits applied (refactor-clean: 48 findings; decision-budget:
~90). Rulings where drafts split or audits corrected the first cut: Bun install + Node runtime · vitest
projects · D's package split with C's names plus a `commands` package so `protocol` stays a leaf · daemon
**runs** `dispatch` over its own frame protocol (the spike's `pglite-socket` mechanism dropped; D6 unchanged)
· session-sample envelope · offline export = warn-if-fallback-else-69 · sharp = encode + delivery downscale
only, Rust owns every other resample · one color core in Rust with `LinearImage.space` · CIRAW before LibRaw
with verdict files G1–G6 · C's no-env-skip Docker gate + real-HTTP fake gateway · D's workbench · `tag` lands
with the race (02) · `generate` lands once (13a) · fixture manifest from an independent tool · strict never
fails on geometry (D27) · `migrate_required` → `restore` (pgDump is the cross-PG-version path) · prune by a
cache index, never atime · IPTC delivered as XMP `dc:*` + EXIF `Artist/Copyright` through sharp · Swift helper
packed as `packages/mac-helper-*` · duet-agent citations kept, framed as "lift from" · **License: MIT** (repo public 2026-09-03; LibRaw under CDDL, OpenColorIO math BSD-3, SAM 2.1 Apache-2.0 all compatible; GPL code never linked).

## Supersedes

- `visualizations/map.html` "Implementation prompt" and "Tweakable build plan" → this README + `slices/`.
  Its A′ flat pinned-layer representation, `fill --refresh`, 12-hex hash examples, and gateway-shaped provider
  events are also superseded by `choices.md`'s 2026-09-05 DAG decisions and slices 08–13. Other ledger entries,
  OPEN items, sharp edges and landmine cards remain authoritative inputs.
- `visualizations/session-sample.html` B3/B4 (export refusal, strict dims failure, flat refresh hint, gateway-only
  provider event) → D27/D28, the envelope section, and slices 09/12's DAG execution contracts.
- `assets/concurrency-spike/daemon.mjs` + `cli-socket.mjs` mechanism (PG-wire) → the daemon frame protocol in slice 02.
- D35's reservation of `restore` for a future provider capability → top-level `photoctl restore` is catalog recovery in slice
  03. V1 has no provider-restoration verb; any later provider operation must use a distinct name rather than overload it.

## Implementation notes

*(append-only; one entry per deviation: plan said / code revealed / call made / needs David?)*

- **2026-09-05 — slice 08a2 checkpoint capture.** Plan said: open the structure-only `wb graph` checkpoint and run the
  unprimed visual critique. Code revealed: the available in-app browser was disabled and the enabled Chrome surface rejected
  local `file:` URLs; its policy explicitly prohibited an indirect local-server workaround. Call: keep the generated report and
  its structural HTML tests, record the visual checkpoint as unavailable rather than claim it green, and leave the non-blocking
  screenshot gate for the next environment with an allowed local browser surface. Needs David: no; no product decision depends
  on this blocked evidence.

- **2026-09-05 — slice 05 delivery publication boundary.** Plan said: export always writes a profiled delivery file and never
  clobbers an existing path unless overwrite is explicit. Code revealed: checking a filename and later renaming over it leaves
  a race where another process can create the path between those operations. Call: publish ordinary and renamed deliveries with
  an atomic no-replace link where supported; filesystems without hard links use exclusive create/write/fsync, preserving
  no-clobber at the cost of in-progress reader visibility. Only `--on-collision overwrite` uses replacement. The file becomes durable before its history row,
  so a database failure can leave an unrecorded delivery but never a history row that points to a file not yet published. Needs
  David: no; this preserves the two explicit safety properties across filesystem/database boundaries.

- **2026-09-05 — slice 08a1 logical/execution split.** Plan said: deterministic node identity included input artifact hashes while
  develop and crop commands could commit a revision without rendering. Code revealed: those requirements cannot share one identity;
  the input artifacts do not exist at mutation time, and source fallback would rewrite document history. Call: make logical node
  identity depend on ordered input node identities, and give pixel executions a separate evaluation identity over actual ordered
  artifacts plus source provenance. Nondeterministic roots additionally require a published artifact anywhere in their reachable
  paid ancestry before activation. Needs David: no; the architecture audit confirmed this reconciliation before the schema landed.
- **2026-09-05 — slice 04 sampled relocation boundary.** Plan said: sampled-key collisions require full proof, while a rename on
  the same online volume retains its ID after the old path disappears. Code revealed: once that old path is gone, its bytes are
  unavailable for a full comparison; treating every missing locator alike either breaks the required rename or aliases offline
  uncertainty. Call: keep the inference only for a missing old path on the candidate's confirmed-mounted volume; refuse
  offline/unknown volumes, compare full hashes whenever an old locator is readable, and refuse exact-locator unpromoted matches
  when stored mtime changed. Needs David: no; this is the narrow reconciliation of the two explicit slice clauses, with the
  residual adversarial ambiguity recorded in `choices.md`.
- **2026-09-05 — slice 04 internal copy volume.** Plan said: `--copy` stores originals under the library and all locators use a
  volume UUID plus relative path. Code revealed: library-owned files have no independent hardware UUID and must resolve after the
  source mapping disappears or the whole library moves. Call: reserve catalog-local UUID `photoctl-library`, resolve it relative
  to the current library root, and still derive the physical macOS mount before Trash selection. Needs David: no; the locator is
  stable within its only namespace and removes a test-environment dependency from ordinary copy libraries.

- **2026-09-03 — commit `0cd23c0`.** Plan said: a README-only edit (precedent-repos table). Code revealed: a
  concurrent Codex session was implementing slice 00 in this working tree; a `git add -A` swept its
  in-progress work (protocol, commands, test-harness, fixtures/tools, Docker seam, `choices.md`) into that
  commit under the wrong message. Call: leave history as is (David's decision); slice-00 authorship is Codex's;
  agents in this repo `git add` only the paths they changed.
- **2026-09-04 — slice 01a durability.** Plan said: turn `fsync` on after PGlite opens. Code revealed:
  PGlite 0.5.8 starts Postgres with `-F` (fsync disabled), and Postgres rejects changing `fsync` in a
  running session. Call: remove `-F` through PGlite's public `startParams`, set
  `synchronous_commit=on`, and assert both live values on every open. Needs David: no; this is the
  required durability invariant expressed at the only lifecycle where Postgres permits it.
- **2026-09-04 — slice 01a lock reclamation.** Plan said: reclaim a dead PID's `wx` lockfile by
  unlinking it. Code revealed: two contenders can both inspect the dead file, then one can unlink the
  other's newly-created live lock; a synchronized concurrent probe reproduced overlapping holders. Call: keep
  the same external payload file, but hold a kernel advisory lock on its open descriptor for the whole
  library session. A killed process releases the kernel lock atomically, so no stale unlink is needed;
  `fs-ext` is a trusted native install dependency on the supported macOS/Linux targets. Needs David: no;
  this replaces a racy mechanism with the single-writer invariant the decision requires.
- **2026-09-04 — slice 01b import scope.** Plan said: `import <file|folder> --link`, while explicitly
  allowing a single-file, non-recursive implementation in 01b. Code revealed: accepting a folder now
  would require inventing slice-04 scanning, aggregation, and partial-failure semantics. Call: 01b
  accepts exactly one file and returns a usage error for a directory; slice 04 remains the sole owner
  of recursive folder import. Needs David: no; this takes the plan's stated narrow path without adding
  a temporary scanner.
- **2026-09-04 — slice 01b import result.** Plan said: return the A2 envelope, but A2 did not provide a
  durable way for the next `show` or `export` command to learn the imported photo ID and did not define
  the volume value when every input is unsupported. Code revealed: command composition needs the IDs and
  a batch with no admitted image has no source volume to summarize. Call: add `ids:string[]` and use `volume:null` when skipped;
  both are additive fields in the typed result. Needs David: no; the result now exposes the catalog
  identity it created without weakening existing fields.
- **2026-09-04 — slice 07a G3 host gate.** Plan said: prove CIRAW under SSH with no window server and
  record a two-run checksum. Code revealed: the helper produces byte-identical output in the normal
  host test, but this Mac refuses connections to `localhost:22` because Remote Login is disabled.
  Call: keep the rerunnable SSH probe, record the local evidence separately, and report
  `requires_window_server:null` rather than guessing pass or fail. Needs David: enable Remote Login or
  provide another SSH-capable Mac session to settle G3; 07b remains unblocked.
- **2026-09-04 — slice 02 daemon bootstrap.** Plan said: every command reaches an auto-started daemon.
  Code revealed: `init` must create and migrate the library before a daemon can acquire its lock or open
  its PGlite directory. Call: `init` alone dispatches in-process, closes its bootstrap handle, then starts
  the daemon; every subsequent library command dispatches through that daemon. Needs David: no; the
  resulting lifecycle and public envelope are the planned contract without a second initialization path.
- **2026-09-04 — slice 02 transferred lock.** Plan said: a client takes the free library lock, spawns the
  daemon, and the daemon rewrites the payload. Code revealed: releasing and reacquiring between those steps
  creates a second-writer window. Call: inherit the locked descriptor as daemon fd 3, close only the parent's
  copy, and rewrite the payload through the inherited descriptor. Needs David: no; OS descriptor inheritance
  makes ownership continuous through startup and `kill -9` still releases it atomically.
- **2026-09-04 — slice 02 integration review.** Plan said: mutations are retry-safe and daemon control reports
  real state. Code revealed: a failed post-init spawn turned a committed library into an error, status invented zero values,
  idle sockets consumed request capacity, and stop could report success for a live unresponsive holder. Call: initialization
  returns success plus a daemon warning after its durable boundary; control probes the owner, verifies exit, counts only framed
  work, and uses owner-only socket/log permissions. Needs David: no; the public result now follows durable state.
- **2026-09-04 — slice 07a transitional output paths.** Plan said: Rust owns every non-delivery resample and decoder probes write
  linear 16-bit TIFF. Code revealed: the Rust resampler and canonical linear Rec.2020 ICC do not exist yet, so 07a uses Sharp for
  file-decoder scale and emits an untagged TIFF. Call: keep those limitations explicit, assign preview/file scaling migration to
  slice 10 and TIFF profile tagging to 7c; slice 14 synchronizes the helper version with the root release version. Needs David:
  no; these are named prerequisites, not accepted final-state exceptions.
- **2026-09-05 — slice 07c CIRAW neutrality.** Plan said: zero the named Core Image enhancement
  controls and compare the two RAW decoders within G4. Code revealed: CIRAW also carries per-file
  baseline exposure, shadow bias, local tone mapping, and (on supported macOS versions) highlight
  recovery defaults; leaving them active failed the unchanged G4 threshold at mean ΔE00 `4.723`.
  Call: explicitly neutralize those presentation controls. The exact same oracle then passed at mean
  `1.927`, p95 `2.791`. Needs David: no; this enforces the existing neutral-decode requirement rather
  than changing its tolerance.
