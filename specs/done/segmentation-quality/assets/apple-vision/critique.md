# Apple-native portrait baseline

Apple's accurate person mask is a useful outer-hair baseline, not a replacement
for hair-only prompting. Person-instance segmentation retains some longer
flyaways more faintly; foreground-instance segmentation overfills the hair
silhouette. No variant establishes PhotoLab parity.

## Contract and method

These APIs select people or foreground instances. Face and clothing inclusion
is therefore expected, not an implementation bug. None separates the forehead
curl from selected skin. No synthetic clipping or manual hair correction was
applied.

The [method/results](method-and-results.json) retain revisions, timing, output
dimensions, alpha statistics and comparison distances. All three requests ran
once successfully on macOS 26.4.1. Accurate person took 2.74 seconds, person
instances 2.98 seconds, foreground instances 0.21 seconds, excluding subsequent
mask scaling. These are single ordered observations, not benchmark estimates.

Float32 masks are preserved in scratch. Review images clamp alpha to [0,1]
without binary thresholding. Person-instance scaled output overshoots that range;
the raw values remain recorded. Accurate-person native output is bilinearly
resized to source dimensions; instance masks use Apple's official image-scaled
output. Each instance API found one instance, whose mask equals its union.

## Review

Labels in [full](comparison-full-overlay.png), [crown](comparison-top-overlay.png)
and [bottom](comparison-bottom-overlay.png) comparisons are A=accurate person,
B=person instances, C=foreground instances. Source-sized alpha is retained for
[A](person-accurate-alpha16.png), [B](person-instances-alpha16.png) and
[C](foreground-alpha16.png).

An unprimed reviewer inspected the original source, all thirty full/feature
triptychs and supplemental individual alpha crops. Parent inspection of full
and all five feature overlays agrees:

- A preserves the circular crown curl and open loops most convincingly. B weakens
  them; C merges openings into a solid silhouette.
- A/B trade off right-edge curl continuity against finer, fainter strand structure.
  Both retain translucent background; C fills much more background opaquely.
- B retains faint geometry of long bottom loops. A loses most of them. C makes
  a blunt hanging shape that includes background and omits finer extensions.
- No large dense-hair holes or obvious global alignment error are visible.
- Whole-person selection cannot solve the internal hair/skin boundary. Carried
  flowers are partly excluded by B and included more strongly by A/C.

Complete raw masks and captures remain at `/private/tmp/openphoto-apple-vision.ZasdH1`.
Do not mistake attractive outer-edge matting for correct hair-only semantics.

## Newer native option

Apple's [iterative segmentation API](https://developer.apple.com/documentation/vision/generateiterativesegmentationrequest)
accepts point, box and scribble seeds plus included/excluded points. It requires
macOS 27, unavailable on this host. This is a substantially closer semantic
comparison to SAM, but was not executed. No OS upgrade is authorized or needed
to preserve this evidence.
