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

## Built and installed fixture journey

The [shared paired-originals journey](../../../test/journeys/paired-originals.ts) drives
both the built CLI and the packed-install suite. It uses a permanent camera pair with
unequal RAW/JPEG dimensions in link and copy modes. Default import keeps one RAW-led
photo; RAW edits leave explicit camera-JPEG previews and deliveries unchanged. Removing
only the scratch JPEG makes explicit JPEG access fail honestly while RAW access works;
restoration and reimport preserve photo/original identities. Original and managed-copy
hashes are checked after the complete journey.

The isolated built and prebuilt-runtime installed executions passed all four cases
on 2026-09-06; the installed CLI ran outside the checkout with its persistent daemon.
The integrated built pair also passed on the corrected native runtime. Deliberately
ignoring camera-JPEG export selection failed the source-identity assertion, then passed
after restoration. These are source-routing and lifecycle proofs, not a fresh-native
full packed gate, photographic verdict, or mounted-camera acceptance.

The current-native installed witness also passes both link/copy cases (20.41 seconds)
on source `c201502`, using the unchanged shared oracle outside the checkout with its
persistent daemon. The installed and tarball-extracted addon both match
`95d804f431a544226789ca69b3c20f9e5e1f5f851912d7ff26863bf39e2f8984`;
both decoders are available and both daemon PIDs are absent after stop. Existing
compiled native/helper artifacts were packaged through the normal pack owner, not
rebuilt. This closes the current-runtime installed pairing gap, not the full fresh-build
release gate. The report, command results, package hashes and test output remain at
`/private/tmp/photoctl-pairing-current-install.so0AVR/REPORT.md`.

The [complete macOS closeout](local-closeout-2026-09-07.md#docker-and-macos-results)
now passes all freshly built packed-install cases, including both pairing modes.
The earlier prebuilt-runtime evidence above retains its narrower historical scope;
fresh-package verification is no longer an outstanding pairing requirement.

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
exports, not the prescribed people preset and ten exports. The subsequent
[mounted gold run](mounted-gold-2026-09-07/README.md) now proves that exact mechanical
journey through a fresh installed CLI. It does not repeat explicit camera-JPEG access
in the same catalog, so pairing slice D's combined witness was incomplete at that checkpoint.
A rerunnable fixture journey cannot retroactively replace that missing evidence.

A 2026-09-07 read-only recheck found permanent JPEG candidates with matching
sampled identities and sizes, but the gold catalog has no full content hashes or
local locators for them. The ordinary identity owner must read an existing
original before promoting that match; a filename or sampled key is insufficient
proof. Inspection stopped before import/show/export, without accessing the card,
changing locators, migrating or resetting the catalog. Before/after catalog and
fixture-hash comparisons were unchanged. Only this exact-catalog witness needs
an authorized readable original; fixture development does not need reconnection.

## Same-catalog camera-JPEG witness — 2026-09-08

With renewed user authorization, the retained mounted-gold installation and catalog
successfully ran `show --source camera-jpeg` and `export --source camera-jpeg` for
photo `01a07aa2-d112-75bd-a28d-66ca8b120747`. Both selected JPEG original
`01a07aa2-d112-75bd-a28d-6202b69ca3af`, not its RAW primary. Show reported the JPEG's
7008×4672 source dimensions; export produced a local 320×213 JPEG without warnings.
This closes the missing same-catalog access witness above, not workbench layout or
photographic quality. It used the existing installed CLI with `PHOTOCTL_NO_DAEMON=1`;
the earlier gold exam separately established the persistent-daemon journey.

The camera volume UUID matched the retained locators. Both commands ran under a
macOS sandbox denying all `file-write*` operations beneath `/Volumes`. No import,
source removal, rename or XMP write/sync command ran. Before/after SHA-256 values
were identical for both accessed originals:

- RAW: `95d78941e0503eafa760e4e6ffde4ce6ae4b22e73a642ccb3b815debbcd6ee39`
- JPEG: `e1c2c961a23e917ffb2006dc017d087185cc6a9042e040ffa4cf84860aeb8241`

The delivery's independently checked dimensions are 320×213 and SHA-256 is
`16d69fd180926ae6b05b70f8e3e3db21a609475ccd538b76347b5aef6eee6e5a`.
It remains under `/private/tmp/photoctl-camera-jpeg-verified.mBfRp9`;
preview/cache and export history belong to the local test catalog. The card was
not remounted, and no whole-card or macOS mount-metadata invariance is claimed.
Further camera access is unnecessary for this witness.

## Presentation evidence remains incomplete

`/private/tmp/photoctl-paired-visual.EiW3Lt` contains public CLI evidence and matched
baseline/candidate contact-sheet HTML for three distinct retained camera pairs.
The states include an unavailable RAW with an available JPEG, an available RAW
with an unavailable JPEG, and both available. Only scratch copies were renamed.
The sheet test verifies the membership labels, but does not certify their layout.

The browser rejected the local HTML URL and explicitly disallowed indirect
workarounds. A direct in-app-browser attempt on 2026-09-07 is also policy-blocked;
no alternate route was attempted afterward. No UI screenshot or fresh layout
acceptance is claimed. Workbench membership-badge layout still needs a user-supplied
capture or an independently permitted capture route, followed by visual review.

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
