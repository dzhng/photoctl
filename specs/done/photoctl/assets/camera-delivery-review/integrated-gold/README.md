# Integrated RAW recovery delivery

The corrected normal path is visibly less wrong than the prior delivery: conspicuous
magenta highlight cores are removed without changing composition or ordinary skin
and shadow rendering. This is bounded acceptance of that correction, not complete
camera photographic acceptance. Thin colored highlight fringes and flat clipped
cores remain; neither a successful export nor a lower pixel difference settles them.

## Preserved-library proof

The unchanged gold script ran against the same disposable library identified by the
[pre-policy snapshot](../pre-policy-snapshot.json), retaining its old caches and
canonical artifacts. Only its new nullable execution-treatment column was explicitly
added for this test, with all 46 historical values left unknown. No product migration,
backfill, reset or real-library modification was used.

The first invocation omitted this library's fixture volume mapping and stopped with
`file_offline` during import. Restoring its existing `camera-reference-fixtures` mapping
allowed the unchanged script to complete all ten exports. This setup failure was not
a decoder or photographic result.

[The report](gold-exam-report.json) records actual command envelopes and RAW source IDs.
Its SHA-256 is `d2b7cee0460b34ce7edc54ff035cb155a3bc18ddb68d6a4e10433026fea055eb`.
The delivery manifest verified every JPEG and both reports. Complete deliveries remain
at `/private/tmp/photoctl-camera-reference-gold.cc9Ux2/reconstruction-delivery`.

[Preservation evidence](preservation.json) verifies unchanged prior photo records,
originals, locators, document state, edits and revisions. All 46 historical execution
rows and 15 artifact records remain unchanged apart from the newly present nullable
field. All 15 artifact files and 19 cached files retain their original hashes; cache
last-used records changed normally. The run adds 23 treatment-bearing executions and
11 artifacts. This library has no paid attempts and cannot establish paid-history
retention by itself.

## Visual comparison

The collection contains all ten full-image A/B comparisons and seven paired native
detail regions. A is the prior reduced-RGB-corrected delivery, B is integrated normal
reconstruction; the gold script and presets are unchanged. Full views fit 1000 pixels;
native detail is enlarged twice with nearest-neighbor sampling. [Metrics](metrics.json)
pin complete JPEG hashes and exact crop coordinates. Nine deliveries change bytes;
the unsupported reduced-RGB DSC00103 remains byte-identical, with its stripe correction
preserved. Differences are localized, not evidence of general color-profile matching.

Root inspected all 34 captures. Fresh PNG-only review
`01a075f3-bd34-7523-a2fd-dcd4dbcbe122` independently preferred B in six scenes and tied
four; none favored A. Its opening tally said five before correcting itself to the six
enumerated scenes. Both inspections find the major magenta cores corrected in lamps,
flame, sky, aquarium lighting and bridge lighting, with no clear new geometric or
fine-structure damage. Flat white cores, thin pink/cyan/yellow boundaries, low-light
noise and softness remain. These captures do not determine whether every residual
edge is optical, demosaicing-related or reconstruction-related, nor prove lost texture
can be recovered.

The candle A/B overviews opened for a non-blocking human checkpoint at 09:01:44 UTC
on 2026-09-06. With no visual feedback after five minutes, the bounded improvement
verdict was retained and only those two documents were closed. No whole-camera
acceptance is inferred from silence. The separate all-reference and installed-runtime checks own their broader
coverage; this fixture journey does not establish physical-card acceptance.

## Installed runtime boundary

A separate normal release build, pack and clean install through `dbe550a` passed six
selected macOS package tests in 141.81 seconds: distributed source/license terms,
installed decoders and daemon/fixture gold, warm and cold outpaint, and full-frame
source promotion/refresh. The unrelated agent-preview journey was deliberately not
selected. No release tag or publication was used; the test installation was cleaned
and its daemon stopped. [Package/runtime hashes](installed-runtime-hashes.json)
identify this build, which is distinct from the root build used for these captures.

[Installed RAW diagnostics](installed-raw-diagnostics.json) additionally record four
successful calls on the permanent candle original. Both packaged LibRaw and CIRAW
report applied treatment by default and disabled treatment when requested. Their
quarter-scale TIFFs and actual method/version records prove the installed boundary,
not native-detail photographic equivalence between decoders or a complete release gate.
