# 05 — CLI cutover without saved-mask migration

Seam: configured segmentation maps signed points with explicit provenance from
base or rendered image into the prepared frame exactly once. The command passes
each instance only its own automatic points. Automatic text uses points-only;
its box locates the instance but does not enter the decoder. Manual `--at` stays
positive; `--at` plus explicit `--box` sends both. Box-only and brush stay manual.

The user approved text-plus-click instance selection. Hit-test in the same
render frame; return a clear usage error for no match or overlapping candidates
instead of guessing. Never broadcast the click to all matches. Automatic points belong to the delivered
render frame and must be in bounds; user points outside the crop retain the
existing usage error. Never silently drop semantic negative points.

Preserve per-instance ordering, empty-match no-op/lazy encoding, dry-run without
commits, pre-grounding expected revision and revision-conflict errors, progress,
source warnings and unchanged envelope shape. Existing fractional-mask summary
semantics remain authoritative: bbox/pixels describe nonzero support, including
soft samples. They are metadata, not persisted crop geometry. With sigmoid tails
that support can cover the full frame; do not reinterpret it as opaque selected
area. Quality smoke evidence measures alpha>=0.5 coverage and alpha sum separately,
while saved alpha and the public summary contract remain unchanged.

Red/green through command consumers: target-specific signed masks, empty matches,
multiple instances, crop/rotation, text-plus-click resolution, dry-run, revision
conflict and replay of an existing fractional saved mask without the model.
Rebuild and run the actual CLI on the reference source, hair and entire person.
Human surface: saved layers and raw/black/white/overlay captures. Compare actual
CLI output, not a Python reimplementation, with the reference using
compare-screenshots; unprimed screenshot-critique is last before acceptance.

Delegated: internal composition, not public flag semantics, output storage or
revision ownership. Keep manual/edit/history tests green.
