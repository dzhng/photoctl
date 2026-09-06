# Paired-originals verification

The public regression owner is
[`paired-import.test.ts`](../../../packages/commands/src/paired-import.test.ts).
It exercises real camera companions through import, inspection, edits and export,
including the retained pair whose RAW and JPEG have different resolutions. These
are behavior checks, not a photographic-quality baseline.

## Independent code review

The read-only review found stale locator queries in tests, case-only XMP target
collisions, search filenames selected from the JPEG companion, and explicit
single-kind imports blocked by ambiguity in excluded companions. Each was reproduced
and corrected through the public command tests; no finding was dismissed. The XMP
case-folding tradeoff is recorded in the choices ledger. A separate graph fixture
was updated to author the current checkpoint stages without weakening its history
or cursor assertions.

The survivor, source-routing, dimension, copy-cleanup and elapsed-time checks were
also falsified with controlled mutations and restored. These focused checks do not
replace the integrated packed-release or presentation gates below.

## Merged integration

The merged tree passes 96 focused checks across pairing and original-file lifecycle,
existing white balance/outpaint/generation consumers, workbench output, the keyless
fixture gold exam, and real-CLI metadata backup/restore. The TypeScript build completed
before these tests, so the CLI exercised current built packages. These are not a
full-suite or packed-release verdict.

The independent merged static review (`01a074d9-389e-7301-8abf-7726ffbafe84`)
found no actionable defects in ownership, pairing, lifecycle, source routing or
adapted consumers. An earlier review was terminated after its unbounded changed-test
sweep overloaded the shared host; it is not counted as a completed review or test gate.

## Partial live-camera witness

On 2026-09-06, a development worktree linked the contents of
`/Volumes/Untitled/DCIM/101MSDCF` on volume
`0051C01F-A0CE-36FC-9386-477DA323CD33`. It admitted 431 logical photos from 862
originals without conflicts. Ten photos were rated; three received an exposure
adjustment and were exported. Explicit camera-JPEG show/export also succeeded.
The card was read, never written, and no mass original-copy operation was used.

Import took 643.50 seconds; listing ten rows from that catalog took 41.02 seconds.
The three exports took 13.80 seconds together. These are measurements from that
development build, not release performance guarantees. They exposed inspection
progress and unnecessary list work; changing the source validation policy or
relaxing timeouts is not justified by these timings.
The bounded availability correction and its work-count proof are recorded in
[the culling performance review](list-availability-performance.md).

Scratch evidence is retained at `/private/tmp/photoctl-paired-camera.D2ev5A`.
The original script stopped on an incorrect positional rating argument; the saved
resume script used `--stars` and continued without repeating the import. Both
attempts remain recorded. No actual unplug/reconnect test was performed.

This is **not** the shared gold exam: it used an exposure adjustment and three
exports, not the prescribed people preset and ten exports. The exact mounted-drive
journey and packed-release gate remain open. A rerunnable fixture journey cannot
retroactively replace that missing live-drive evidence.

## Presentation evidence remains incomplete

`/private/tmp/photoctl-paired-visual.EiW3Lt` contains public CLI evidence and matched
baseline/candidate contact-sheet HTML for three distinct retained camera pairs.
The states include an unavailable RAW with an available JPEG, an available RAW
with an unavailable JPEG, and both available. Only scratch copies were renamed.
The sheet test verifies the membership labels, but does not certify their layout.

The browser rejected the local HTML URL and explicitly disallowed indirect
workarounds. No UI screenshot or fresh visual acceptance is claimed. The required
full-image/orientation-crop comparison and unprimed screenshot critique remain
open; a user-supplied capture or an independently permitted capture route is needed.

The separate [fixture orientation evidence](paired-orientation/README.md) exercises
public image artifacts directly without opening HTML. Its image-geometry verdict
does not certify workbench membership-badge layout or the physical-camera journey.

## Clean-start coverage

Original-byte identity now belongs to `originals`; photo IDs still own edits and
culling. Fresh-schema, collision, backup/restore and graph cleanup tests use that
model. Compatibility-only historical upgrade assertions were removed under the
user's explicit no-migration development cutover. Their historical dump files were
not rewritten or deleted, and unrelated lifecycle behavior was retained in fresh
catalog tests.
