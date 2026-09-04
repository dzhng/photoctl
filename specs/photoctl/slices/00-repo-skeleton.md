# 00 — repo skeleton, Docker seam, `protocol` + `commands`, `photoctl --version`, fixture manifest tool

## Contract unlocked
`bun run verify` is a real gate from commit 1. `photoctl --version` prints a valid envelope. One functional
test spawns the **built** CLI inside `test:functional`; the harness fails the run if zero tests executed
(permanent self-test). The fake gateway service exists (501 for every route). The fixture manifest is
produced by a tool independent of the code under test.

## API seam
- `packages/protocol/src/envelope.ts`: `Envelope`, `Warning{code:WarningCode,id?,message}`, closed unions
  `ErrorCode = usage|not_found|partial|unsupported_file|library_locked|daemon_unavailable|file_offline|volume_readonly|
  catalog_unreadable|migrate_required|decoder_unavailable|provider_unconfigured|provider_unverified_mask|provider_whole_frame|provider_busy`
  and `WarningCode = source_offline|layers_stale|vacancy_unfilled|provider_unconfigured|provider_warning|xmp_stale|label_unknown`;
  `exitCodeFor`: usage→2; not_found/partial/unsupported_file/provider_whole_frame→65; file_offline/volume_readonly/
  catalog_unreadable/migrate_required/decoder_unavailable/provider_unconfigured/provider_unverified_mask/daemon_unavailable→69;
  library_locked/provider_busy→75. Later slices say "extends ErrorCode/WarningCode with …".
- `packages/protocol/src/events.ts`: `{"event":"progress",phase,done,total,per_sec?,eta_s?}`, `{"event":"daemon",action,pid,socket,version,schema}`,
  `{"event":"provider",gateway,model,op,mask,sent_px,format}`, `{"event":"warn",code,id?,message}`.
- `packages/protocol/src/request.ts`: `CommandRequest{verb, args, cwd, env:{noDaemon}}`; `verbs/version.ts` first Zod data shape.
- `packages/commands/src/dispatch.ts`: `dispatch(req, ctx) → Promise<Envelope>` — the ONE command API. `apps/cli`
  serializes it; `apps/daemon` (02) runs it; `--no-daemon` calls it in-process. Library helpers throw `PhotoctlError{code}`;
  dispatch maps once.
- `packages/test-harness/src/{spawn.ts,library.ts,gateway-fixture.ts,manifest.ts,hold-lock.ts}`: `spawnPhotoctl(args,{libraryDir,env})
  → {code,json,events}` (always `node apps/cli/dist/bin.js`; honours `PHOTOCTL_NO_DAEMON`); `withLibrary()`; fake gateway
  `http.createServer` on `PHOTOCTL_GATEWAY_URL`; `readManifest()`; `hold-lock.js <lib> <ms>` (opens the library and sleeps).
- `fixtures/tools/manifest.py` (stdlib only): TIFF IFD walk for embedded JPEG `{w,h,offset,length}`, `size`, `sha256` content key
  per the 01b formula, `DateTimeOriginal`/`OffsetTimeOriginal` raw strings → writes `fixtures/a7c2.json`; `fixtures/README.md`
  records the command. Tests read the manifest; they never call importer code to derive expectations.
- Layout per README; `turbo.json` (`test` dependsOn `^build`); `bunfig.toml` (`linker = "hoisted"`); Cargo workspace with
  empty `crates/photoctl-image`; `.oxlintrc.json`/`.oxfmtrc.json` + `packages/typescript-config` copied from `~/dev/duet`.
- `fixtures/*.ARW` are Git LFS objects (`.gitattributes` committed); the Dockerfile installs `git-lfs` and the compose mount carries the fetched files.
- `test/Dockerfile` (node:24-bookworm, bun for install, rustup, clang), `test/compose.yaml` (`functional`, `gateway-fixture`).
- **CI + tag releases, lifted from `~/dev/duet-agent/.github/workflows/`** (already committed at `.github/workflows/{ci,publish}.yml`):
  `ci.yml` runs install → build → lint → test on every push/PR; `publish.yml` runs the same gates on `v*` tags, creates a GitHub
  Release with generated notes, then `bun run publish:npm`. This slice makes both green: root `package.json` gets `version`,
  `publish:npm` (publishes `apps/cli` + `packages/img-*` + `packages/mac-helper-*` with `--provenance`; a no-op until those exist),
  and `npm version` bumps the root + workspace versions together. A release = `npm version <bump> && git push --follow-tags`.
  `NPM_TOKEN` is a repo secret David adds before the first tag.

## Human can run
`bun run build && node apps/cli/dist/bin.js --version`; `bun run test:functional`; `bun run verify`.

## Verification
`cli-version.test.ts` (envelope shape, exit 0; unknown verb → 2 `usage`); `harness-self.test.ts` (vitest with an empty include
→ non-zero); `manifest.test.ts` (`fixtures/a7c2.json` matches `fixtures/README.md` rows). Build gates (not tests): `cargo test`
on the empty crate, `swift build` no-op off Mac.

## Delegated: argument-parser library; vitest config; Dockerfile layer order.
## Must stay green: itself. Deps: none. Firewall: no domain code, no PGlite.
