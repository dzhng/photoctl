# 14 — real-drive gold exam + packed-install release gate

## API seam
`bun run pack` → tarballs for `apps/cli`, `packages/img-darwin-arm64`, `packages/mac-helper-darwin-arm64` (ships
`photoctl-mac`; `-darwin-x64` as a sub-slice); `scripts/install-clean.sh` (`npm install -g ./*.tgz --prefix <clean>`);
`otool -L` audit; `photoctl doctor` from the packed install must report `ciraw` and `libraw`. `scripts/gold-exam.sh
/Volumes/<drive>/<folder>` → `assets/gold-exam/<date>/report.html` + sha256s. Real Classic sidecars → `fixtures/xmp/`; one frame
per ARW compression mode → `fixtures/` with manifest rows; `decoder-libraw.test.ts` is parametrized over manifest rows (absence is
not a skip). The root release version is the one owner for the CLI, package manifests, and the Swift helper's `--version` output;
the version-sync test fails if any packaged surface drifts.

## Verification
The gold exam (human accepts JPEGs as deliverable); `packed-install.test.ts` (macos): packed CLI runs the fixture gold exam; linkage
audit. The full-feature run also executes the keyless fake-adapter reimagine and masked-density cases from 12/13, verifies full
render/node/artifact hashes and paginated graph inspection from the packed CLI, and proves missing live upscaler credentials do not
block release. A configured live adapter remains smoke evidence, never a release prerequisite.

## Checkpoint (real input): three real JPEGs — professional "not broken"; `people` retune is data-only. Use
`compare-screenshots` against their accepted pre-generation render when applicable and run an unprimed `screenshot-critique` last;
review is non-blocking per the root rule.
## Must stay green: everything. Deps: 08 (min), 13 (full). Firewall: taste edits touch preset/prompt data only.
