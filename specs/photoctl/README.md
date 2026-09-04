# photoctl v1 — build ladder

CLI-first photo library + editor for Mac (portable core). TypeScript on Node 24, PGlite,
a Rust napi addon, a Swift Core Image helper, Vercel AI Gateway. Audience: professional
photographers (shoot → cull → rate → deliver); agents drive it one-shot from a chat loop.

This folder is the plan. `visualizations/map.html` is the decision ledger (D1–D40 + A′)
this plan implements; `assets/spec-input.md` is David's original spec + delta. Where the
map's kickoff prompt, open-questions list, or the session sample disagree with this
README, **this README wins** (see "Supersedes").

## Next Agent Prompt

*Last updated: 2026-09-03. Status: plan complete, no code written. Repo scaffolded at
`ac8ff67..deeffb4` (skills, spec inputs, `fixtures/a7c2.ARW`, `.gitignore`, `AGENTS.md`).*

You are resuming photoctl. Read this README top to bottom, then open the slice file for
the pickup point and follow it exactly. Do not re-decide anything in the decision ledger
(`visualizations/map.html`, Quadrant 2) or in "Contracts" below; if the code forces a
deviation, append it to "Implementation notes" (what the plan said, what the code
revealed, the conservative call) and keep going.

- **Pickup point:** `slices/00-repo-skeleton.md`. Nothing has been built.
- **Blockers:** none for slices 00–08. Live-key work (09b, 12 pre-gate) waits on David's
  Gateway key; the real-drive gold exam (14) waits on the drive path. Neither blocks
  deterministic work — placeholders are named per slice.
- **Before ending your pass:** update this section (status, date, pickup point, blockers),
  tick the TODO below, and run the closeout gate named by the slice you finished.

### Global TODO
- [ ] 00 repo skeleton, Docker seam, `protocol`, `photoctl --version` — `slices/00-repo-skeleton.md`
- [ ] 01 init → import a7c2.ARW → show → export embedded JPEG — `slices/01-first-jpeg.md`
- [ ] 02 daemon + lock under real contention — `slices/02-daemon-and-contention.md`
- [ ] 03 backup/restore/migrate/prune + schema-v1 fixture — `slices/03-library-lifecycle.md`
- [ ] 04 import at scale, locators/offline, cull verbs, XMP read — `slices/04-import-and-cull.md`
- [ ] 05 delivery export (+ keyless gold-exam dry run) — `slices/05-delivery-export.md`
- [ ] 06 xmp write / sync — `slices/06-xmp-write-sync.md`
- [ ] 07 decoders: CIRAW, LibRaw, oracle — `slices/07-decoders.md`
- [ ] 08 develop: dict, render, local ops → **gold exam green** — `slices/08-develop.md`
- [ ] 09 providers, embed worker, hybrid search — `slices/09-providers-embed-search.md`
- [ ] 10 layers, transforms, composite, vacancy, A′ — `slices/10-layers-and-composite.md`
- [ ] 11 segment: SAM 2.1 local, `--text` grounding — `slices/11-segment.md`
- [ ] 12 fill pipeline, strict composite, person-move flow — `slices/12-fill.md`
- [ ] 13 reimagine/relight/auto_enhance/generate, markup, retouch — `slices/13-generative-extras-and-markup.md`
- [ ] 14 real-drive gold exam + packed-install release gate — `slices/14-gold-exam-and-release.md`
- [ ] 15 (optional) MCP facade — `slices/15-mcp.md`

## Goal and closeout gate

**Gold exam (must pass, keyless):** with `photoctl` on PATH on David's Mac: import a folder
of A7C II ARWs from the external drive `--link` → `list` → `rate` 10 → `develop` 3 with
`--preset people` → `export` JPEGs a photographer would deliver. No GUI, no gateway key.
Runs for real in slice 14; a fixture-driven version is a test from slice 08 on.

## Slice graph

```
00 repo ─ 01 first-jpeg ─ 02 daemon ─ 03 lifecycle ─ 04 import+cull ─ 05 export ─ 06 xmp-write
                                  │                                        │
                                  └─ 07 decoders (7a ciraw → 7b libraw → 7c oracle) ─ 08 develop ★gold
                                                                                        │
                       09 providers+embed+search (needs 02, 04) ──────┐                 │
                                                                      ├─ 10 layers ─ 11 segment ─ 12 fill ─ 13 extras+markup
                                                                      │
                                                     14 real-drive gold + release gate ─ 15 mcp (optional)
```

Gold exam is green after 08. 09 can run in parallel with 07/08. Every slice leaves
`photoctl` runnable and its tests green through the Docker seam.

## Repo shape (decided)

Bun 1.3.x is the package manager, workspace/catalog resolver, script runner and Turbo
launcher (the `~/dev/duet` precedent). **Node 24 executes all project code** — the CLI, the
daemon, every test, every spawned worker. `bun` never runs a `.ts` of ours. Rust is a root
Cargo workspace (the `~/dev/game` precedent: root scripts span TS and Cargo).

```
photoctl/
  package.json  turbo.json  bunfig.toml  Cargo.toml  .oxlintrc.json  .oxfmtrc.json
  apps/
    cli/              bin photoctl → dist/bin.js: argv → dispatcher → stdout/stderr. No domain logic.
    daemon/           Unix-socket server hosting the same dispatcher + background workers.
    workbench/        dev-only `wb`: one HTML report per slice into out/wb/ (never shipped).
    mcp/              slice 15 only.
  packages/
    protocol/         ONE owner: envelope, error codes, exit codes, stderr events, per-verb Zod shapes, CommandRequest.
    library/          PGlite open/lock/session, migrations (NNNN-*.ts), backup (pgDump), identity, locators, xmp, search fusion.
    importer/         scan, EXIF (timezone owner), embedded-preview index, cache tiers/prune, XMP read.
    render/           decoder interface, render graph, coordinates, develop dict + tier table, layers, transforms, export planning.
    providers/        gateway adapter × model adapters, fixed model table, prompts, fake-gateway client contract.
    img/              napi loader for crates/photoctl-image; per-platform packages.
    test-harness/     spawnPhotoctl (built JS only), withLibrary, fake gateway server, fixture manifest reader.
    typescript-config/
  crates/
    libraw-sys/       vendored LibRaw 0.22.2 (CDDL-1.0), --disable-openmp, libc++ dynamic.
    photoctl-image/   napi: decode, develop ops, masks, resample, composite, SAM (ort CPU), heal, draw.
  helpers/mac/        SwiftPM "photoctl-mac": CIRAWFilter decode + Vision horizon. No AppKit.
  fixtures/           committed known-good/bad assets + README manifest (a7c2.ARW, xmp/, libraries/, providers/)
  test/               Dockerfile, compose.yaml (functional + gateway-fixture services)
  throwaway/          gitignored probes
```

Root scripts (bare = whole job, `:suffix` = one part):

```
build            build:ts (turbo) && build:rust (napi, packages/img) && build:swift (helpers/mac; no-op off Mac)
test             test:ts && test:rust && test:functional && test:macos
test:functional  docker compose -f test/compose.yaml run --rm functional     ← THE gate; fails visibly if Docker/fixtures missing
test:macos       host-only vitest project (CIRAW helper, hdiutil volume, Trash)
test:rust        cargo test --workspace
lint / typecheck / fmt / fmt:check   oxlint, tsc, oxfmt + cargo fmt + swift-format
verify           fmt:check && lint && typecheck && build && test
wb               node apps/workbench/dist/cli.js
fixtures:drive   N padded copies of a7c2.ARW + Classic-style sidecars into a folder
fixtures:volume  hdiutil image with a real volume UUID (Mac) for the offline case
smoke:*          with-key scripts: mask-polarity, embed-shape, headless-ciraw
```

## Testing rules (from `/write-tests`, D38)

- Functional tests drive the **built** CLI (`node apps/cli/dist/bin.js`) as real OS processes
  against real PGlite data dirs, inside `test:functional`. No `testIfDocker`/env-gated skips
  in the suite: the compose command *is* the seam; if it can't run, it fails loudly.
  The runner also fails if zero tests executed.
- External edges are substituted, nothing internal: a real-HTTP **fake gateway** service
  (Vercel-shaped requests → canned PNGs at sent dims, canned `box_2d`, fixed 3072-d vectors;
  modes for dims-mismatch and whole-frame warnings), and the volume/mount edge
  (`PHOTOCTL_VOLUME_MAP` maps a directory to a fake UUID + online flag).
- Every timing budget is injectable via env and re-derived from measured Node spawn time;
  never copied from duet's Bun-era constants.
- Unit tests only for pure logic: envelope/exit mapping, transform composition, tier table,
  timezone parser, RRF, color operators on synthetic ramps.
- Fixture facts (content key, embedded tiers, shot instant) live in `fixtures/README.md` and
  `fixtures/a7c2.json`; tests read them, never re-derive.
- Visual output: `screenshot-critique` last on every rendered artifact; `compare-screenshots`
  whenever a reference or prior render exists.

## Contracts (single owners — refactor-clean)

| Concept | Sole owner | Slice |
|---|---|---|
| Envelope `{schema:1, ok, code?, data?, results?, summary?, warnings?}`, closed `ErrorCode` union, exit 0/2/65/69/75, stderr NDJSON events, `CommandRequest` | `packages/protocol` | 00 |
| Command dispatcher (CLI, daemon, MCP all call it; `--no-daemon` = same dispatcher, in-process) | `packages/protocol/dispatch` | 00/01 |
| Library handle (`query`), ONE lock model, session, refuse-to-open, backup/restore, migrations | `packages/library` | 01–03 |
| Identity (content key), locators (`files` 1:N), volume/online state | `packages/library/{identity,locators}` | 01/04 |
| Timezone (`DateTimeOriginal`+`OffsetTimeOriginal` → instant+offset) | `packages/importer/exif` | 01 |
| Embedded preview index + cache tiers + prune | `packages/importer/{embedded,cache}` | 01/03 |
| Decoder interface (`LinearImage`: f32 linear Rec.2020, oriented) | `packages/render/decoder` | 07 |
| Render graph `renderPhoto()` (embedded source day one; develop node 08; composite 10; draw 13) | `packages/render/graph` | 01 |
| Coordinate space (oriented, uncropped, top-left; crop last; `--norm`) | `packages/render/coordinates` | 01 (`show.dims`) |
| Develop dict, hash, presets, **tier table** (A′ as data) | `packages/render/develop` | 08 |
| Export planning (template, collision, IPTC, history); **sharp** is the only encoder/resizer/ICC writer | `packages/render/export` | 01/05 |
| XMP read / explicit write / sync / stale | `packages/library/xmp` | 04/06 |
| Provider: gateway adapter × model adapter; fixed model table; prompts (versioned IDs) | `packages/providers` | 09 |
| Embed worker + RRF search | `packages/library/search`, `apps/daemon/workers` | 09 |
| Layer model (one noun; roles subject/vacancy/reimagine/retouch), transforms (S→R→T matrix computed once) | `packages/render/{layers,transforms}` | 10 |
| Masks, strict composite (above adapters), resample, SAM, heal, draw | `crates/photoctl-image` | 10–13 |
| Fixture manifest | `fixtures/README.md` + `fixtures/*.json` | 00 |

No compatibility wrappers. Schema changes are forward-only numbered migrations, each
upgrading `fixtures/libraries/schema-v1.pgsql`. The only transitional implementation is
`renderPhoto`'s `source:"embedded"` path — and it is **not removed**: it is the permanent
offline/identity source (D23/D28). The fake gateway and the volume map are permanent test
edges, not scaffolding.

## Envelope (resolves the map D10 vs session-sample wording)

The session sample (A4/A6, accepted by David) puts `results`/`summary` at the top level.
That is the contract:

```json
{"schema":1,"ok":true,"data":{...},"warnings":[{"code":"source_offline","id":"…"}]}
{"schema":1,"ok":false,"code":"library_locked","data":{"holder_pid":48990,"waited_ms":30000}}
{"schema":1,"ok":false,"code":"partial","summary":{"ok":2,"failed":1},"results":[{"id":"…","ok":true},{"id":"…","ok":false,"code":"not_found"}]}
```

Exit: 0 ok · 2 usage · 65 data (`not_found`, `partial`, `provider_dims_mismatch`) ·
69 unavailable (`file_offline`, `provider_unconfigured`, `daemon_unavailable`,
`catalog_unreadable`, `migrate_required`) · 75 temp (`library_locked`).

**Offline export (resolves D28 vs integration case 5):** if any fallback source exists
(pinned 1616 tier, cached full-size tier, cached develop render) export writes it with
`warnings[{code:"source_offline"}]`, exit 0. Only when nothing is writable → `file_offline`, 69.

## Spec amendments carried from the map (apply when writing code/docs)

Sidecars only, explicit `xmp write` (D19) · drop `--json`, JSON default (D10) · OpenColorIO
grading math instead of "port darktable/ART" · LibRaw is LGPL-2.1 OR CDDL-1.0, take CDDL ·
Vercel only for v1 behind a gateway adapter (D25) · `copy_edits_from` → `develop --copy-from` ·
`unblur` cut (D35); `relight` = prompt template with `drift:"full-frame"`; `--strength` =
feather + guidance, documented as not A1111 denoise · added verbs: `flag label next remove
layer(transform|reorder|set|duplicate|remove|clear) xmp(write|sync) cache prune backup restore
migrate daemon(start|stop|status) embed`; `export --resize --template --on-collision --iptc
--preset`; `segment --text --dry-run`; `fill --move --by`; `--relative`; `--no-daemon`; `--stream`.

## Known unknowns (OPEN on the map) and where they land

| OPEN | Slice | Placeholder |
|---|---|---|
| ARW drive path | 14 (real gold exam); 04 uses it if present | `fixtures:drive` copies + `fixtures:volume` |
| Gateway key + per-verb model IDs | 09a (`doctor`, config); 12 | fake gateway; `provider_unconfigured` |
| Smoke 1 mask polarity | 12 pre-gate | adapters declare `maskPolarity:"unverified"`; live native-mask fill refused until recorded |
| Smoke 2 multimodal embedding shape | 09b | fake gateway vectors; real mode stays manual |
| Lossless-L tag 6/7, M/S pseudo-RAW | 07b probe | uncompressed a7c2 only; LibRaw reads both |
| PGlite TOAST on wide vectors | 09b spike, gates 09c | append-only writes if reproduced |
| Founder checklist (Classic masters + XMP) | 04/14 | hand-authored Classic-style sidecars in `fixtures/xmp/` |

## Human review checkpoints (non-blocking)

Open evidence with `preview-shots`, name the one variable judged, wait ~5 min, decide on
evidence if silent, record the call in the slice file, close windows. Listed per slice.

## Drafts and rulings (scrollback audit)

Four blind drafts were synthesized (Claude A fewest-slices, B risk-first, D feedback-loop;
Codex C seam-quality; in `assets/drafts/`). Rulings where they split:
Bun install + Node runtime (A/C/D over B's npm-only) · vitest projects over `node --test` ·
D's package split with C's names (`protocol`, `library`, `importer`, `render`) · session
sample envelope over D's nesting · offline export = warn-if-fallback-else-69 · sharp as the
permanent encoder (A) over Rust encode (D) · CIRAW before LibRaw (A/D) with B's verdict files
as sub-slice artifacts · C's no-env-skip Docker gate and real-HTTP fake gateway over
`testIfDocker` + in-process stub · D's workbench adopted · B's concurrency slice adopted ·
C's release gate adopted · retouch as its own small unit inside 13 · reimagine lands as a
full-frame layer (D/C) to keep never-overwrite.

## Supersedes

- `visualizations/map.html` "Implementation prompt" and "Tweakable build plan" sections →
  superseded by this README and `slices/`. The map's ledger (Quadrant 2), OPEN list,
  sharp edges and landmine cards remain authoritative inputs.
- `visualizations/session-sample.html` B3/B4 (export refusal, strict dims failure) →
  superseded by D27/D28 and the envelope section above.

## Implementation notes

*(append-only; one entry per deviation: plan said / code revealed / call made / needs David?)*
