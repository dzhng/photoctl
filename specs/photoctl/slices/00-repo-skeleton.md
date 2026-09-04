# 00 — repo skeleton, Docker seam, `protocol`, `photoctl --version`

## Contract unlocked
`bun run verify` is a real gate from commit 1. `photoctl --version` prints a valid envelope. One
functional test spawns the **built** CLI inside `test:functional` and the run fails if zero tests
executed. The fake gateway service exists (returns 501 for everything) so later slices only add
handlers.

## API seam
- `packages/protocol/src/envelope.ts`: `Envelope`, `ErrorCode` (closed union: `usage not_found partial
  library_locked daemon_unavailable file_offline catalog_unreadable migrate_required unsupported_file
  provider_unconfigured provider_dims_mismatch provider_unverified_mask layers_stale`), `exitCodeFor(code)`
  → 0/2/65/69/75, `Warning{code,id?,message}`, stderr `Event` union (`progress|daemon|provider|warn`).
- `packages/protocol/src/dispatch.ts`: `dispatch(req: CommandRequest, ctx) → Promise<Envelope>` — the ONE
  command API. `apps/cli` serializes it; `apps/daemon` (02) transports it; `--no-daemon` calls it in-process.
- `packages/protocol/src/verbs/version.ts`: first Zod data shape (`{version, node, pglite}`).
- `packages/test-harness/src/{spawn.ts,library.ts,gateway-fixture.ts,fixtures.ts}`: `spawnPhotoctl(args,
  {libraryDir, env}) → {code, json, events}` (always `node apps/cli/dist/bin.js`); `withLibrary()`;
  `readFixtureManifest()` (parses `fixtures/README.md` table + `fixtures/a7c2.json`).
- Layout, root scripts, `turbo.json` (`test` dependsOn `^build`), `bunfig.toml` (`linker = "hoisted"`),
  `Cargo.toml` workspace with empty `crates/photoctl-image`, `.oxlintrc.json`/`.oxfmtrc.json` copied from
  `~/dev/duet`, `packages/typescript-config` copied from `~/dev/duet/packages/typescript-config`.
- `test/Dockerfile` (node:24-bookworm + bun for install + rustup + clang), `test/compose.yaml` with
  services `functional` and `gateway-fixture` (`packages/test-harness/src/gateway-fixture.ts`, plain
  `http.createServer`).
- `fixtures/a7c2.json`: `{content_key, size, embedded:[{w,h,offset,length}×3], shot:"2023-10-02T18:18:37+02:00",
  shot_offset_min:120, dims:{w:7008,h:4672}}` — measured values from the map; slice 01's tests read them.

## Human can run
`bun run build && node apps/cli/dist/bin.js --version` → `{"schema":1,"ok":true,"data":{"version":"0.1.0",...}}`;
`bun run test:functional` → 1 test passed inside Docker; `bun run verify` green.

## Verification
- `test/cli-version.test.ts` (functional): spawn → envelope shape, exit 0; unknown verb → exit 2 `usage`.
- Harness self-test: `test:functional` with zero discovered tests exits non-zero (assert via a
  deliberately empty include pattern in a throwaway run, then remove).
- `cargo test --workspace` passes on an empty crate; `swift build` no-op off Mac.

## Delegated to the implementer
Argument-parser library; vitest config details; Dockerfile layer order; oxlint rule tweaks.

## Must stay green
Itself. **Deps:** none. **Firewall:** no domain code, no PGlite yet.
