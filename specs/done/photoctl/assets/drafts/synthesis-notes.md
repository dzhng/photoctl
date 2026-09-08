# Synthesis ledger — A (fewest), B (risk-first), D (feedback-loop); C (codex, seams) pending

## Independent agreement (firm ground)
- Slice 1 = init → import a7c2.ARW --link → show → export embedded full-size JPEG; keyless, no Rust/Swift. All three.
- Lock lifted from duet with: file-lock.ts payload shape + pid liveness + bounded age + SIGINT/SIGTERM, EPERM=unknown, poll ceiling 100ms, keep clearStalePostmasterLock, fix session.ts:203-213 leak, withDb returns discriminated result. All three cite the same lines.
- One `Queryable`/`LibraryHandle` interface with two transports (direct PGlite under lock; pg client over socket). A, D explicit; B via openLibrary.
- Daemon: $TMPDIR/photoctl-<hash8>.sock, spawn under lock, respawn once, idle-exit 15 min suppressed by background task hook, unmount shutdown, --no-daemon everywhere. All three.
- Embedded JPEG path is NOT scaffolding — it is the permanent offline/fallback render source. All three.
- Decoder interface with one owner; ciraw (Swift helper, headless) + libraw (vendored 0.22.2 CDDL, --disable-openmp) behind it; oracle test with stated tolerance; camXyz[0]≈0.7460 as the 0.22 assertion. All three.
- Develop: one dict, tier table as single-owner data file, presets = session D1–D3 verbatim, develop_hash, render determinism test as prerequisite for strict composite. All three.
- Provider: gateway × model adapter, hard-coded model table (no capability fields), stub gateway selected by env, provider_unconfigured exit 69, structured output via generateObject+Zod. All three.
- Strict composite lives ABOVE adapters; adapters normalize dims and report resampled; provider "whole image" warning = hard failure under strict. All three.
- Layers: one noun, transform S→R→T absolute default, coords in oriented uncropped base (a geometry/space owner), vacancy = full silhouette, magenta placeholder, export warns (D28). All three.
- Tests: functional through the built CLI, PHOTOCTL_TEST_IN_DOCKER gate ON in CI with a "zero tests ran" guard; timing constants injectable and re-derived for Node spawn; volume/online mocked at the filesystem edge via env (PHOTOCTL_VOLUME_MAP / _ROOT / _TABLE). All three.
- OPEN placeholders: a7c2 + generated N-copy drive; stub gateway; smoke scripts for mask polarity + embed shape; TOAST spike before the worker. All three.

## Disagreements → rulings
1. Slice count: A 7 / B 12 / D 19. Ruling: ~13. B's gate-verdict files adopted as sub-slice artifacts (specs/photoctl/assets/gates/G*.txt), not standalone slices, except concurrency which is its own slice (02) in all three.
2. Package manager/runtime: A Bun+Node, B npm-only, D Bun install + Node runtime + turbo. Ruling: Bun for install/scripts/catalog + turbo (duet precedent, user's stated preference to follow siblings); Node 24 executes ALL project code (bin, tests, spawned workers). Rule stated in README: "bun never executes project code".
3. Test runner: A/B node --test, D vitest projects (docker|mac). Ruling: vitest (projects give the mac/docker split cleanly; node --test lacks it).
4. Packages: A core+cli+img+ciraw; B cli+core+providers+img+test-harness; D contract+db+core+providers+img+fixtures + apps/{photoctl,workbench,mcp}. Ruling: D's split (contract, db, core, providers, img, fixtures) + apps/photoctl + apps/workbench; helpers/mac for Swift; crates/{libraw-sys,photoctl-img}. MCP app deferred (no dir until its slice).
5. Envelope for partial/lock errors: A/B top-level summary/results (session sample, user stole A4); D nests under data per D10's four keys. Ruling: session sample wins (user reacted "steal" to A4/A6); contract = {schema, ok, code?, data?, results?, summary?, warnings?}. D10 wording amended in the spec.
6. Offline export: A exit 0 + source_offline warning; B/D file_offline exit 69. Ruling (reconciles D28 with case 5): if a fallback source exists (cached 1616 or full-size tier, or a cached develop render) export writes it with warnings[{code:"source_offline"}]; only when nothing is writable → file_offline 69. Integration case 5 rewritten accordingly.
7. Encoder owner: A sharp permanent; D sharp then Rust encode in slice 10; B sharp. Ruling: sharp is the permanent encoder/resizer/ICC/IPTC owner; Rust never encodes (fewer owners; libvips is battle-tested). Rust addon = decode, develop ops, masks, resample, composite, SAM, heal, draw.
8. Decoder order: A/D ciraw first; B parallel gates. Ruling: ciraw first (gold exam unblocks on Mac), then libraw; both produce verdict files; oracle turns on when both exist.
9. Workbench: D only. Ruling: adopt apps/workbench (`wb`) — one command per slice, HTML into out/wb/, opened via preview-shots; it IS the asset workbench write-spec asks for.
10. Migrations format: B .sql, D .ts. Ruling: .ts (duet runner lifted; migrations are code).
11. Retouch placement: A in develop; B bonus; D own slice. Ruling: own small slice (layer with role retouch) after layers.
12. reimagine as base-swap vs layer: D resolves as full-frame layer (keeps never-overwrite). Ruling: adopt.
13. Gold exam timing: A after 04 (of 7), B after 05 (of 12), D after 10 (of 19). Ruling: after develop-render (slice 08 of ~13); a keyless "gold exam minus develop" dry run after export-deliverable (05) as D proposes.

## Pending C (seam-quality): expect stronger ownership tables; fold into §3 of README; check for any seam none of A/B/D named.
