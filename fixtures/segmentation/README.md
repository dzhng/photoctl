# Segmentation evaluation collection

Use this collection to revisit a result against the exact image that produced it,
and to choose varied scenes for future evaluations. Reference targets, observed
model outputs and proposed tests have different meanings; none is silently
promoted to ground-truth alpha.

## Recorded scenes

| Scene | Selections and evidence | Current interpretation |
|---|---|---|
| [PhotoLab portrait](portrait/photolab/README.md) | Clean video frame, user screenshot and video hair overlay; historical hair results plus [live CLI person/hair evaluations](portrait/photolab/live/README.md). | Comparable historical hair appearance at the supplied viewport, with retained defects. Live person requests execute but fail complete hair/clothing coverage; the fresh hair control retains broad scope with edge errors. |
| [A7C II landscape](landscape/a7c2/README.md) | Exact developed CLI source, historical embedded-JPEG source; sky and paved-path masks; wire, foliage and path detail crops. | Broad selection passes coarse checks; the recorded wire, foliage and path detail review fails. |

These are two distinct photographed scenes. Different crops, developed exports,
embedded previews and the duplicated-portrait instance diagnostic do not add
independent scene coverage. No exported PhotoLab alpha or original portrait still
is available. The landscape has no independent ideal mask.

## Unevaluated camera scene pool

Every row below is a suggested evaluation, with **no segmentation result or
expected mask registered**. Scene descriptions come from the
[camera collection](../camera/README.md); original bytes and technical provenance
stay there. RAW and JPEG are alternative inputs, not interchangeable pixels.
Preserve the exact chosen rendering when a case gains results.

| Category | Existing originals | Suggested selections to investigate |
|---|---|---|
| Portrait / indoor | DSC07633: [JPEG](../camera/DSC07633.JPG), [RAW](../camera/DSC07633.ARW) | Visible person, hair and fabric as separate requests; warm-light boundaries. |
| Portrait / coastal | DSC08819: [JPEG](../camera/DSC08819.JPG), [RAW](../camera/DSC08819.ARW) | Person against waves and sky; compare person and hair scope. |
| Portrait / outdoor | DSC00290: [JPEG](../camera/DSC00290.JPG), [RAW](../camera/DSC00290.ARW) | Entire visible person; subject edges against foliage and architecture. |
| Portrait / indoor / glass | DSC00442: [JPEG](../camera/DSC00442.JPG), [RAW](../camera/DSC00442.ARW) | Person, hair and glass separately under mixed artificial light. |
| Landscape / sunset | DSC08142: [JPEG](../camera/DSC08142.JPG), [RAW](../camera/DSC08142.ARW) | Sky and horizon; saturated-light exclusions. |
| Landscape / mountains | DSC09148: [JPEG](../camera/DSC09148.JPG), [RAW](../camera/DSC09148.ARW) | Sky and mountain ridge as separate targets; distant fine boundaries. |
| Landscape / trees | DSC09903: [JPEG](../camera/DSC09903.JPG), [RAW](../camera/DSC09903.ARW) | Tree silhouette, sky gaps and terrain as separate targets. |
| Woodland | DSC09314: [JPEG](../camera/DSC09314.JPG), [RAW](../camera/DSC09314.ARW) | Branches versus bright sky; small gaps and fine coverage. |
| Urban / night | DSC07730: [JPEG](../camera/DSC07730.JPG), [RAW](../camera/DSC07730.ARW) | City structures and point lights; boundaries in deep shadow. |
| Urban / alley | DSC00122: [JPEG](../camera/DSC00122.JPG), [RAW](../camera/DSC00122.ARW) | Alley structures and small bright lights; dark-region separation. |
| Urban / street | DSC00434: [JPEG](../camera/DSC00434.JPG), [RAW](../camera/DSC00434.ARW) | Sky versus fine street structures; perspective and narrow boundaries. |
| Indoor / restaurant | DSC08541: [JPEG](../camera/DSC08541.JPG), [RAW](../camera/DSC08541.ARW) | Window detail and interior regions under mixed lighting. |
| Glass / shallow focus | DSC08362: [JPEG](../camera/DSC08362.JPG), [RAW](../camera/DSC08362.ARW) | Glass and background separately; transparency, bokeh and highlight ambiguity. |
| Wildlife | DSC09797: [JPEG](../camera/DSC09797.JPG), [RAW](../camera/DSC09797.ARW) | Animal versus foliage and road; fine subject edges. |

The camera collection also retains additional format-coverage pairs. Their
technical coverage does not establish a scene description or segmentation result.
No urban or river segmentation baseline is implied by this index.

## Adding evidence

Give each scene a readable case page. Keep its exact evaluated source, selection
intent, coordinate frame, signed prompts or CLI invocation, model/build identity,
and result provenance together. A reference image must state what it can judge;
an observed mask must state how it was selected and encoded. Keep qualitative
verdicts distinct from area metrics and successful execution.

Reuse camera originals by path instead of copying RAW/JPEG collections. Retain
small review images and masks with hashes; avoid model bytes, encoder features
and scratch libraries. Existing 16-bit result PNGs are quantized records for
review, not byte-identical replacements for canonical f32 mask TIFFs. The case
manifests record what was retained and what was omitted.

The owner authorized retaining these evaluation references locally. This does
not establish public redistribution rights for the DxO extracts or transfer
rights in the owner's camera photographs. Nothing here is a publication grant.
The [collection choices](choices.md) explain the retention boundaries.
