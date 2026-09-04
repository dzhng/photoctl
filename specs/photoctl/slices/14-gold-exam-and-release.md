# 14 — real-drive gold exam + packed-install release gate

## Contract unlocked
The gold exam passes on David's Mac against the real external drive, with `photoctl` installed from a
packed artifact, not the dev tree. Evidence report committed.

## API seam
`scripts/gold-exam.sh <arw-dir>`: import --link → list → rate 10 → develop 3 `--preset people` → export →
writes `specs/photoctl/assets/gold-exam/<date>/{report.html, *.jpg sha256}`. Packaging: `bun run pack` →
tarballs for `apps/cli` + `packages/img-darwin-arm64` (+ `-darwin-x64` sub-slice); install into a clean
prefix; `otool -L` audit of the `.node`; `photoctl doctor` from the packed install. Real sidecars from Classic
(when they arrive) copied into `fixtures/xmp/` with provenance lines in `fixtures/README.md`. One frame per ARW
compression mode added to `fixtures/` (OPEN Lossless-L) and `decoder-libraw.test.ts` parametrized over them.

## Human can run
`bun run pack && bash scripts/install-clean.sh && photoctl doctor && bash scripts/gold-exam.sh /Volumes/<drive>/<folder>`.

## Verification
The gold exam itself (human accepts JPEGs as deliverable); `packed-install.test.ts` (mac): the packed CLI
runs the fixture gold exam; linkage audit passes.

## Checkpoint (real input): three real JPEGs — professional "not broken" acceptance; `people` retune is data-only.
## Must stay green: everything. Deps: 08 (min), 13 (full). Firewall: taste edits touch preset/prompt data only; architecture changes reslice.
