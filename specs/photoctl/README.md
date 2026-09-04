# photoctl v1 — build ladder

CLI-first photo library + editor for Mac (portable core). TypeScript on Node 24, PGlite, a Rust
napi addon, a Swift Core Image helper, Vercel AI Gateway. Audience: professional photographers
(shoot → cull → rate → deliver); agents drive it one-shot from a chat loop.

This folder is the plan. `visualizations/map.html` is the decision ledger (D1–D40 + A′) this
plan implements; `assets/spec-input.md` is David's original spec + delta. Where the map's kickoff
prompt, open-questions list, or the session sample disagree with this README, **this README wins**
(see "Supersedes").

## Next Agent Prompt

*Last updated: 2026-09-03. Status: plan complete after two audits (refactor-clean, decision-budget);
no code written. Repo scaffolded (skills, spec inputs, `fixtures/a7c2.ARW`, `.gitignore`, `AGENTS.md`).*

You are resuming photoctl. Read this README top to bottom, then open the slice file for the pickup
point and follow it exactly. Do not re-decide anything in the decision ledger (`visualizations/map.html`
Quadrant 2), in "Contracts", or in "Global rules"; if the code forces a deviation, append it to
"Implementation notes" (plan said / code revealed / call made / needs David?) and keep going.

- **Pickup point:** `slices/00-repo-skeleton.md`.
- **Blockers:** none for 00–08. With-key work (09b smoke, 12 pre-gate) waits on David's Gateway key;
  the real-drive gold exam (14) waits on the drive path; SAM weight hosting (11a) waits on a release URL.
  None blocks deterministic work — placeholders are named per slice.
- **Before ending your pass:** update this section, tick the TODO, run the closeout gate named by the slice.

### Global TODO
- [ ] 00 repo skeleton, Docker seam, `protocol` + `commands`, `photoctl --version`, fixture manifest tool — `slices/00-repo-skeleton.md`
- [ ] 01a library open, ONE lock, refuse-to-open, `init`, `doctor` — `slices/01-first-jpeg.md`
- [ ] 01b import a7c2.ARW → show → export embedded JPEG — `slices/01-first-jpeg.md`
- [ ] 02 daemon (runs `dispatch`), contention race, `tag` — `slices/02-daemon-and-contention.md`
- [ ] 03 backup/restore/migrate/prune + schema fixture — `slices/03-library-lifecycle.md`
- [ ] 04 import at scale, locators/offline, cull verbs, XMP read — `slices/04-import-and-cull.md`
- [ ] 05 delivery export + `scripts/gold-exam.sh` (keyless dry run) — `slices/05-delivery-export.md`
- [ ] 06 xmp write / sync — `slices/06-xmp-write-sync.md`
- [ ] 07 decoders: 7a CIRAW, 7b LibRaw, 7c oracle — `slices/07-decoders.md`
- [ ] 08 develop: 8a dict · 8b1–3 color core · 8c1–4 local ops/NR/geometry/filters → **gold exam green** — `slices/08-develop.md`
- [ ] 09 providers (9a), spikes (9b), embed worker + search (9c) — `slices/09-providers-embed-search.md`
- [ ] 10 layers, transforms, composite, vacancy, A′ — `slices/10-layers-and-composite.md`
- [ ] 11 segment: 11a SAM runtime, 11b verbs — `slices/11-segment.md`
- [ ] 12 fill pipeline, strict composite, person-move flow — `slices/12-fill.md`
- [ ] 13a reimagine/relight/generate · 13b auto_enhance · 13c markup · 13d retouch — `slices/13-generative-extras-and-markup.md`
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
00 ─ 01a ─ 01b ─ 02 ─ 03 ─ 04 ─ 05 ─ 06
          │                    └─ 09 (needs 02, 04; parallel with 07/08)
          └─ 07 (7a → 7b → 7c) ─ 08 ★gold
                                  └─ 10 ─ 11 ─ 12 ─ 13a/b   (13c markup, 13d retouch need only 10)
                                        14 ─ 15
```

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
    library/          PGlite open/lock/session, migrations, backup (pgDump), identity, locators, settings, xmp, search fusion.
    importer/         scan, format table, EXIF (timezone owner), embedded-preview index, cache tiers/index/prune.
    render/           decoder interface, render graph, coordinates, develop dict + operator/tier tables, layers, transforms, fill pipeline, markup, export planning.
    providers/        gateway adapter, model adapters (image + structured), fixed model table, versioned prompts.
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
- **Coordinates** are oriented, uncropped, top-left base pixels; `bbox = [x,y,w,h]`; crop/straighten apply
  last; adapters convert external frames once and never leak them (D13). `--norm` (0..1) accepted wherever coordinates are (from 10).
- **Two buckets:** generation = SOTA general model + versioned prompt; restoration/geometry = specific local solution (D26).
- **CoreML EP** is a constraint, not a plan item: no slice enables it in v1; if ever enabled it must be per
  model, static shapes, ≥2× measured, output-equivalent within tolerance; CPU is the reference (D40).
- **Never write RAW bytes; never write into source folders except explicit `xmp write`** (D19).
- **One resampler:** every pixel-space resample (layers, provider normalize, SAM letterbox) is
  `photoctl-image::resample`; **sharp** does encode/ICC/XMP/EXIF + the final delivery downscale only.
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
| Input format table; EXIF + timezone; embedded-preview index; cache tiers + index + prune | `packages/importer` | 01b/03 |
| Decoder interface + `LinearImage{space}`; decoder selection | `packages/render/decoder` | 07 |
| Color core (levels→WB→matrix→ops→TRC), delta kernels, NR | `crates/photoctl-image::develop` | 07c/08/10 |
| Render graph `renderPhoto() → Image16` (embedded source day one; develop node 08; composite 10; draw 13c) | `packages/render/graph` | 01b |
| Coordinate space (`toBase/fromBase`, bbox, letterbox mapping) | `packages/render/coordinates` | 01b |
| Develop dict, hash, presets (package data + `<lib>/presets/develop/`), **operator table**, **tier table** | `packages/render/develop` | 08 |
| Export planning (template, collision, IPTC-as-XMP/EXIF, presets `<lib>/presets/export/`, history); sharp encode | `packages/render/export` | 01b/05 |
| `scripts/gold-exam.sh` | scripts | 05 |
| XMP read / explicit write (parse-merge) / sync / stale | `packages/library/xmp` | 04/06 |
| Gateway adapter; `ImageModelAdapter` + `StructuredModelAdapter` (frame conversion, mask polarity); fixed model table; versioned prompts; cost table | `packages/providers` | 09a |
| Embed worker; RRF search | `apps/daemon/src/workers/embed.ts`; `packages/library/search` | 09c |
| Layer model (roles subject/vacancy/reimagine/retouch; `fill_params`), transforms (S→R→T matrix once) | `packages/render/{layers,transforms}` | 10 |
| Fill pipeline (mask fit, crop policy, normalize, strict composite call) | `packages/render/fill` | 12 |
| Masks, resample, composite, lift, SAM, heal, draw | `crates/photoctl-image` | 10–13 |
| Markup model + flatten | `packages/render/markup` | 13c |
| Fixture manifest + generator | `fixtures/README.md`, `fixtures/a7c2.json`, `fixtures/tools/` | 00 |

**Transitional seams (each named with its end):** (1) 01b's `renderPhoto` has one source node; 08 adds
develop, 10 composite, 13c draw — the embedded source is permanent (offline/identity). (2) 05's gold-exam
dry run omits `develop`; 08 adds it to the script — no stub verb exists. (3) 08a's `develop` result carries
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

**Offline export:** fallback precedence = develop render with matching hash > cached full-size tier >
pinned 1616 tier; any of them → write + `source_offline` warning, exit 0; none → `file_offline` 69.

## Spec amendments carried from the map

Sidecars only, explicit `xmp write` (D19) · drop `--json`, JSON default (D10) · OpenColorIO grading math
instead of "port darktable/ART" · LibRaw is LGPL-2.1 OR CDDL-1.0, take CDDL · Vercel only for v1 behind a
gateway adapter (D25) · `copy_edits_from` → `develop --copy-from` · `unblur` cut (D35); `relight` = prompt
template with `drift:"full-frame"`; `--strength` = feather (documented, not A1111 denoise). **Verbs added
vs the input spec** (the inventory itself is `packages/protocol/src/verbs/`): `flag label next remove
layer(list|show|transform|reorder|set|duplicate|remove|clear) xmp(write|sync) cache prune backup restore
migrate daemon(start|stop|status) embed decode render presets(show) search`; `export --resize --template
--on-collision --iptc --preset`; `segment --text --dry-run`; `fill --move --to|--by`; `--relative`;
`--no-daemon`; `--stream`; `doctor --fetch-models`.

## Known unknowns (OPEN on the map) and where they land

| OPEN | Slice | Placeholder |
|---|---|---|
| ARW drive path | 14 (04 uses it if present) | `fixtures:drive` + `fixtures:volume` |
| Gateway key + per-verb model IDs | 09a (`doctor`, `settings`); 12 | fake gateway; `provider_unconfigured` |
| Smoke 1 mask polarity | 12 pre-gate | adapters `maskPolarity:"unverified"` → live native-mask fill refused (`provider_unverified_mask` 69) |
| Smoke 2 multimodal embedding shape | 09b | fake gateway vectors; real mode stays manual |
| Lossless-L tag 6/7, M/S pseudo-RAW | 07b probe; 14 fixtures | uncompressed a7c2 only |
| PGlite TOAST on wide vectors | 09b, gates 09c | append-only writes if reproduced |
| SAM 2.1 ONNX hosting URL | 11a | export script committed; download URL `settings.models_base_url` |
| Founder checklist (Classic masters + XMP) | 04/14 | hand-authored Classic-style sidecars in `fixtures/xmp/` |

## Human review checkpoints (non-blocking)

Open evidence with `preview-shots`, name the ONE variable judged, wait ~5 min, decide on evidence if
silent, record the call in the slice file, close windows. One variable per checkpoint; listed per slice.

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
packed as `packages/mac-helper-*` · duet-agent citations kept, framed as "lift from".

## Supersedes

- `visualizations/map.html` "Implementation prompt" and "Tweakable build plan" → this README + `slices/`.
  The map's ledger, OPEN list, sharp edges and landmine cards remain authoritative inputs.
- `visualizations/session-sample.html` B3/B4 (export refusal, strict dims failure) → D27/D28 and the envelope section.
- `assets/concurrency-spike/daemon.mjs` + `cli-socket.mjs` mechanism (PG-wire) → the daemon frame protocol in slice 02.

## Implementation notes

*(append-only; one entry per deviation: plan said / code revealed / call made / needs David?)*
