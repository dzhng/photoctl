# 06 — explicit sidecar writes, divergence detection

## Contract unlocked
Ratings/flags/labels/tags round-trip to Classic-compatible sidecars only when asked (D19); external
edits are detectable and pullable (D20). RAW bytes are never touched.

## API seam
`packages/library/src/xmp/{write.ts,sync.ts,diff.ts}`; `photoctl xmp write <id...>` (writes `<stem>.xmp`
beside the original; refuses if the volume is read-only → `file_offline`-style code `volume_readonly` 69);
`photoctl xmp sync --read <id...>`; `list --xmp-stale`; `doctor` counts stale sidecars. Flags go under a
`photoctl:` namespace; ratings/labels/keywords in standard fields.

## Human can run
`xmp write`, edit the sidecar, `list --xmp-stale`, `xmp sync --read`; `wb xmp` diff table.

## Verification
`xmp-roundtrip.test.ts` (rate 4 + tag + label → write → wipe DB rows → import fresh → same values; ARW
sha256 unchanged); `xmp-stale.test.ts` (touch sidecar → stale; sync → updated, `read_at` advanced).

## Delegated: hierarchical keyword mapping detail.
## Must stay green: 01–05. Deps: 04. Firewall: no embedded-XMP; no develop in XMP.
