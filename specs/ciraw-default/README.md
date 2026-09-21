# CIRAW default implementation record

Automatic RAW rendering uses CIRAW with applied highlight reconstruction and the
existing neutral helper settings. No preset, extra default compression, automatic
decoder/JPEG fallback, or compatibility mode. Saved adjustments and authored image
assets survive deterministic render invalidation. Explicit camera-JPEG access and
diagnostic decoder commands remain available.

## Completed work

Implementation and fixture cleanup are complete. The selected references remain
in the camera fixtures; the obsolete decision map is deleted. Production-route
[visual evidence](assets/README.md) includes independent full-image and crop
review, plus byte-identical recaptures using rebuilt debug and release binaries.
The final [choices ledger](choices.md) has been independently audited. Shape,
diff, documentation and independent Codex reviews have no unresolved findings.

The original full `bun run verify` failed on stale test expectations and fixture
issues. Their affected host reruns pass. The full Docker TypeScript suite passed
218 files / 1,246 tests; the corrected model stage passed separately. Rust tests,
format, lint, typecheck and native builds pass. Real-Mac RAW decoding, segmentation,
and the unchanged warm-preview performance threshold pass. Final focused cache
checks pass on the host and in Docker.

## Next Agent Prompt

The final clean packaged-install rerun passed all 11 tests. Commit this
implementation, then archive this record and audit the archived claims.
Stop the temporary model mirror and test gateway service. No design decisions or
implementation work remain open.
