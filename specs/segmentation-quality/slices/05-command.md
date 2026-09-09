# 05 — CLI cutover without saved-mask migration

Seam: configured segmentation maps signed points with explicit provenance from
base or rendered image into the prepared frame exactly once. The command passes
each instance only its own automatic points. Automatic text uses points-only;
its box locates the instance but does not enter the decoder. Manual `--at` stays
positive; `--at` plus explicit `--box` sends both. Box-only and brush stay manual.

Resolve the pending text-plus-click choice from the implementation plan before
changing its meaning. With no answer preserve the documented existing behavior
and do not claim instance hit-testing. Automatic points belong to the delivered
render frame and must be in bounds; user points outside the crop retain the
existing usage error. Never silently drop semantic negative points.

Preserve per-instance ordering, empty-match no-op/lazy encoding, dry-run without
commits, pre-grounding expected revision and revision-conflict errors, progress,
source warnings and unchanged envelope shape. Existing fractional-mask summary
semantics remain authoritative; inspect that owner before changing any threshold.
Do not count every nonzero sigmoid tail as selected area merely to keep integers.

Red/green through command consumers: target-specific signed masks, empty matches,
multiple instances, crop/rotation, text-plus-click resolution, dry-run, revision
conflict and replay of an existing fractional saved mask without the model.
Rebuild and run the actual CLI on the reference source, hair and entire person.
Human surface: saved layers and raw/black/white/overlay captures. Compare actual
CLI output, not a Python reimplementation, with the reference using
compare-screenshots; unprimed screenshot-critique is last before acceptance.

Delegated: internal composition, not public flag semantics, output storage or
revision ownership. Keep manual/edit/history tests green.
