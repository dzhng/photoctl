# Full-frame refresh and source-promotion candidate

The target is one cropped, quarter-turned physical viewport. Reconnecting the original
must improve deterministic source detail at those same coordinates without buying new
pixels. Explicit refresh may change purchased detail, but not strength, placement or
the removable-layer contract.

`candidate/` contains independently decoded PNG deliveries from the installed tarball
journey. Reduced captures are 30×40; native captures are 60×80 over the same catalog
rectangle. `crops/` enlarges each complete image to 480×640 with nearest-neighbor sampling
for inspection; these are not detail-enhanced images. Cross-density image distances
would conflate sampling with content, so telemetry is per-image. The native refreshed
image and both undo images are byte-exact after independent decoding. Reconnecting
changes source detail while preserving all paid execution IDs; only explicit refresh
creates new paid attempts.

The journey deliberately replaces the import-pinned preview with an 80×60 JPEG, then
removes it after baseline rendering. This is a controlled degraded-cache stimulus, not
the normal preview density produced by import. Crop `{x:20,y:30,w:80,h:60}` and a 90°
turn give exact reduced mapping `[0,0.5,-0.5,0,45,-10]` and native mapping
`[0,1,-1,0,90,-20]`; both describe the same physical rectangle.

The seven states cover reduced before/generated, native generated/refreshed/restored,
undo-upscale and undo-remove. No shot is a provider-aesthetics acceptance criterion:
the local HTTP fake gateway deliberately returns deterministic lower-density pixels.
The original contributes visible fine structure at intermediate strength. Separate
public checks require reduced original-quality reporting even at strength one.

Public evidence includes retained-only creation and refresh with neither original nor
pinned bytes, followed by first show/export, removal/undo and exact reconnect pixels;
corruption/missing-input refusal before purchase; exact fractional input;
current predecessor enablement/removal; current photometric develop in a fixed authored
viewport; unchanged-response intermediate-strength equality; lost-response no replay;
and successful/failed upscale-only refresh preserving generation and the last usable
upscale. The permanent DSC00103 RAW/JPEG pair separately proves unequal original sizes
and camera-JPEG source independence at the built command boundary.

The built lifecycle passes, and the same shared journey passes through a clean installed
tarball produced from the audited native addon/helper without rebuilding either. The
normal packed-install suite registers the journey; its native-build hook was not run
in this bounded pass. Whole-spec gates and live photographic/provider acceptance remain
separate; no paid service or camera was used.

The first independent static review found incorrect active-upscale status after a failed
upscale-only refresh. A public failure witness confirmed it; status now describes the
retained active pixels rather than the failed attempt. A later retained-only display
witness exposed a source traversal gap: the shared evaluator now has an explicit terminal
retained-only policy, with no source or provider callbacks, using the same recursion,
recipe registry, artifact validation, frame binding and publication machinery.

The second independent static review found a normal-preview quality propagation gap;
a public same-pixel/different-source-tier witness failed before the correction and passes
after it. Its proposed removal of captured predecessors after reordering conflicts with
the explicit capture contract: membership survives reorder, while the live stack order is
unchanged. A public refresh witness pins both consequences. A predecessor moved above the
selected layer can therefore appear in the purchased input and remain above it in display.
Missing paid bytes now report the existing `file_offline` unavailable category, never a
decoder installation problem or permission to replay a provider.

A 17×13 retained raster under fractional geometry additionally requires reconstructing
an unrendered fixed-viewport input. This uses the same retained-only evaluation policy and
rechecks source quality before choosing it over an available fallback.

Final bounded checks: all 27 focused full-frame cases passed across the complete-file
run and added ranking witness; 51 evaluator/preview/show/export/relight/upscale neighbors
passed. The final installed lifecycle passed in 8.9 seconds, the permanent-pair built
boundary in 4.8 seconds, and all seven final installed captures match these PNGs byte for
byte. TypeScript build/typecheck, formatting and diff checks passed; scoped lint reports
only pre-existing warnings. Independent static reviews were sessions
`01a07524-5b99-7780-ad61-06ebd51bc18a` and `01a0752e-a7e3-7a52-ab93-8b814f9439d7`.

## Integrated visual review

Main inspection covered all fourteen full images and enlargements. Fresh unprimed
review `01a0753c-a999-7b00-81e2-c687b8e7ad3b` found stable placement through the generated,
refreshed and undo states, conspicuous checkerboard texture at native sampling, and
large color changes. Those observations agree with direct inspection: the synthetic
source contains alternating one-pixel color values, and the fake gateway supplies the
changed color treatment. Smoothing those stimuli would weaken the sampling comparison.
This accepts placement and source-promotion evidence, not photographic texture or model quality.

The reviewer suspected the reduced-before enlargement was narrower and clipped. Direct
PNG metadata disproves its claimed width: both reduced images are 30×40 and both
enlargements are 480×640. The public coordinate transforms above independently bind
the same physical extent. No unexplained offset, missing edge or coverage change was
found in main inspection. Independent decoded RGB hashes confirm both undo outputs
exactly match native-refreshed (`7bd54998229e398d999e9ecc33053794a35dcfc129a8b27fa7c2ff7d50d3947f`).

The reduced/native generated enlargements were opened for a non-blocking human review.
After five minutes without feedback, only those two documents were closed. The
placement/sampling-only verdict above remains the evidence-based decision.

Root integration passed the TypeScript build, 43 full-frame/outpaint tests and 45
shared evaluator/preview/export tests. Independent commit review
`01a07545-737e-7de0-a984-1634303bcc9c` found no actionable correctness issue.
These are focused integration gates, not the whole-spec closeout.
