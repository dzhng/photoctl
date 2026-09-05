# Upscaler experiment contract

An experiment changes one thing at a time. Prompt arms share the same source bytes, scale, fidelity, creativity, and seed.
Control arms share source bytes and guarded prompt while changing only the operator-selected fidelity or creativity value.
Validation sheets reuse the baseline guarded output; they do not silently add more provider calls or choose a release default.

Run the committed synthetic example from the repository root:

```sh
bun run build:ts
bun run wb upscale-spike --config specs/photoctl/assets/upscale-spike/experiment.json
```

The [manifest](experiment.json) is an example of the runner-owned input contract; paths are relative to that manifest, not the
process directory. The [runner](../../../../apps/workbench/src/upscale-spike.ts) owns validation and the report shape. Every source
and mask is fully decoded, and sources are checked against advertised adapter limits before the first adapter call. PNG metadata
alone is insufficient: a truncated file can still advertise valid dimensions. Invalid or interrupted runs cannot leave a previous completed JSON verdict looking current.
Image files from an older run may remain; only the current JSON report identifies the current run's sheets.

The [evidence](evidence/upscale-spike.json) keeps source copies, provider outputs, source/output crop dimensions, prompts,
requested controls, and provider provenance together. Resolved controls are unknown because the adapter boundary does not report
normalization. Detail files retain native pixels. Small detail panels are not resized; oversized panels use an explicitly labeled
fit preview to keep contact sheets bounded. The thin gray outline marks their extent, including white mask regions.
A mask is inspection context only: the upscaler interface does not accept it, and this report does not assert compositor protection.

The category declarations here deliberately exercise only synthetic text and mask/texture layouts. They are not photographs and
do not prove those quality categories acceptable. The fake adapter paints flat colors and ignores control strength: matching
control outputs are therefore not a quality preference. The report retains missing category coverage and never promotes a model.

## Visual verification

Target: distinguish experiment axes and source/output detail without hiding texture loss, while keeping labels and mask extents
legible. The [scene metrics](metrics/scene-metrics.json) locate deliberately flat provider outputs rather than blessing them.
Source imagery has measurable edges; every fake output has zero edge density by construction. The sheets preserve this contrast.
The [detail crop](detail.png) shows the mask panel's native extent and label at 2× scale.

The source-versus-provider [comparison artifacts](comparison/metrics/) normalize source dimensions to the provider output before
measuring pixel and edge differences. The fake output loses every source feature: it is rejected as a photographic candidate,
while serving its intended purpose as a visibly non-photographic boundary fixture.

An independent visual critic found full-sheet labels readable, aligned panels, and no overlap. Its clipped-heading finding in the
zoom crop was corrected by expanding that capture; dimension labels now make the native source/output scale difference explicit.
The [large-crop example](experiment-large.json) and [report](large-evidence/upscale-spike.json) exercise fitted sheet panels without
discarding the full native crop. Independent code review identified that bound and redundant baseline provider work; regression
tests prove both corrections. Choosing a strength equal to the baseline reuses the guarded result and its request identity.

The three-sheet Preview checkpoint stayed open for approximately five minutes without feedback and was then closed. No model
or control preference was selected from fake output. A fresh reviewer was unavailable for the additional large-crop state;
the adversarial check was: fitting could conceal texture loss, but the label explicitly says it is fitted and points to the
retained native PNG. The saved source still contains geometry/text and the provider result visibly loses both, so the overview
does not present that loss as successful photographic preservation.

The layout is contract evidence only. Live-provider quality, photographic preservation, and release-default selection are not
assessed by these captures.
