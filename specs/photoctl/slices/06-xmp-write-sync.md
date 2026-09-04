# 06 — explicit sidecar writes, divergence detection

## Contract unlocked
Ratings/flags/labels/tags round-trip to Classic-compatible sidecars only when asked (D19); foreign nodes (`crs:*`) survive;
external edits are detectable and pullable (D20). RAW bytes never touched.

## API seam
`packages/library/src/xmp/{write.ts,sync.ts}`: `xmp write <id...>` parse-merges into an existing sidecar (all foreign nodes
preserved) or creates `<stem>.xmp`; read-only volume → `volume_readonly` 69. `xmp sync --read <id...>`: sidecar replaces
rating/label/keywords; flags untouched unless `photoctl:flag` present. `list --xmp-stale`, `doctor` stale count (`xmp_stale` warning).

## Verification
`xmp-roundtrip.test.ts` (rate/tag/label → write → wipe → import fresh → same values; `crs:*` nodes survive byte-for-byte;
ARW sha256 unchanged); `xmp-stale.test.ts`.

## Must stay green: 01–05. Deps: 04. Firewall: no embedded-XMP; no develop in XMP.
