# 06 — explicit sidecar writes, divergence detection

## Contract unlocked
Ratings/flags/labels/tags round-trip to Classic-compatible sidecars only when asked (D19); foreign nodes (`crs:*`) survive;
external edits are detectable and pullable (D20). Original image bytes are never touched, regardless of format.

## API seam
`packages/library/src/xmp/{write.ts,sync.ts}`: `xmp write <id...>` parse-merges into an existing sidecar (all foreign nodes
preserved) or creates `<stem>.xmp`; read-only volume → `volume_readonly` 69. `xmp sync --read <id...>`: sidecar replaces
rating/label/keywords; flags untouched unless `photoctl:flag` present. `list --xmp-stale`, `doctor` stale count (`xmp_stale` warning).

## Verification
`xmp-roundtrip.test.ts` (rate/tag/label → write → wipe → import fresh → same values; `crs:*` nodes survive byte-for-byte;
original sha256 unchanged for representative whole-file and embedded-container sources); `xmp-stale.test.ts`.

## Must stay green: 01–05. Deps: 04. Firewall: no embedded-XMP; no develop in XMP.

## Status

Implemented 2026-09-05. The catalog remains authoritative until `xmp write`; that verb verifies an online original locator,
parse-merges only the cull properties, and durably replaces the adjacent sidecar without opening image bytes for writing. Pull
sync applies rating, label, and the complete keyword set in one database transaction, while an absent photoctl flag leaves the
catalog flag alone. Import, write, sync, list, show, and doctor share the library XMP owner and its stored sidecar mtime; no schema
migration was needed. Reads bind XML bytes and timestamps to one opened-file snapshot. Writes verify a strong identity immediately
before publication, atomically displace and validate the destination, and install through a no-clobber hard link. External edits in
either verification window are restored and retried from their new bytes; persistent contention is refused per item. The lexical
merge tracks inherited namespace scope and removes owned values from every RDF Description before adding one canonical set.

Evidence covers a fresh-library metadata round trip, byte-preserved Camera Raw nodes, source checksums for whole-file and ARW
embedded-container inputs, read-only-volume isolation, external pull semantics, stale list/doctor reporting, and the built CLI
protocol seam. Review remediation additionally covers sidecar replacement during read, external edits at the write publication
boundary, repeated-conflict refusal and temp cleanup, inherited namespace conflicts, duplicate owned values across Descriptions,
the exact post-verification/pre-publication replacement window, and `EISDIR` batch isolation. The focused 01–05 consumer sweep is
recorded in the implementing commit's verification output.
