# Integrated CLI: person and hair

These are real gateway-grounded ZIM results on the same portrait, not additional
photographed scenes or independent ideal masks. Each request used one gateway
call, automatic signed points and the highest model score. No hand-edited points,
visually selected candidate or synthesized best-of mask was used.

The [imported source](../source.png) is the historical video frame. The
[developed source](source-developed.png) is the exact pixel image exported by
the CLI before these requests; its decoded RGB differs slightly from the
historical upstream input. All three live captures use byte-identical developed
sources. [Source provenance](../source-provenance.md) and its rights limitations
continue to apply.

## Results

| Request | Observed mask | Verdict |
|---|---|---|
| Whole visible person, ordered provider point pairs | [Overlay](person-ordered-points/review/overlay.png), [black composite](person-ordered-points/review/black.png), [alpha](person-ordered-points/alpha16.png) | Fails: the returned point order was opposite the requested interpretation; bouquet selected and most person pixels missing. |
| Same person request, named provider axes | [Overlay](person-named-points/review/overlay.png), [black composite](person-named-points/review/black.png), [alpha](person-named-points/alpha16.png) | Less wrong, but fails whole-person coverage: skin retained and bouquet excluded; nearly all hair and much clothing missing. |
| Hair-only control, named provider axes | [Overlay](hair-named-points/review/overlay.png), [black composite](hair-named-points/review/black.png), [alpha](hair-named-points/alpha16.png) | Broad hair scope is retained, with halo, background gaps and local skin/flower residue. Not an ideal hair matte. |

Named `x` and `y` fields repair ambiguity at the external provider boundary.
The internal and CLI point contract stays horizontal/vertical image pixels.
The second response places inclusion points on hair, face, arm and clothing,
but its selected mask still fails to retain all those regions. This is a model
coverage failure, not evidence that named axes guarantee semantic completeness.

The [manifest](manifest.json) records every retained file hash, dimensions,
exact invocation, model identity, equivalent implementation commits, source
differences, presentation settings and omitted intermediates. Each run's
metadata retains the gateway request without headers, its semantic response,
decoder scores and process memory. The three runs took about 27.0, 14.9 and
15.8 seconds respectively; these are observations, not latency requirements.
No user memory ceiling is imposed. JavaScript heap and whole-process resident
memory are distinct measurements.

## Independent visual review

Full-frame views and 2× face, bouquet/hand, hair and clothing crops were inspected
in source, overlay, black, white and alpha form. Their complete derived views
remain under each run's `review/`; shared source crops live in [review/](review/).
White backgrounds can conceal missing white fabric; black and alpha views are
necessary to judge it.

The person comparison found the named-axis result substantially better for skin
and bouquet exclusion, but decisively incomplete: the forehead curl becomes a
hole, the left blouse disappears, and right shoulder fabric is weak or translucent.
Thin orange flower-edge residue remains near the cheek and jaw. The ordered-pair
result instead retains the bouquet while omitting the intended person.

The hair control preserves prominent curls and largely excludes broad skin,
clothing and flowers. It still retains a pointed background wedge below the
curls, background in outer curl gaps, skin inside forehead loops, a small detached
skin speck near the flowers and a pale/yellow boundary halo. Fine flyaways are
partly lost or merge into haze. The PhotoLab display target appears to retain
some of the same background wedge; matching it would not establish ideal scope.

Comparison telemetry verifies identical developed sources and materially changed
masks. [Measurements](measurements.json) locate those differences; neither image
distance nor the compressed PhotoLab overlay can certify ground-truth alpha.

## Reuse

Treat the two person runs as retained failing cases and the hair run as an
observed control. Requests for the entire person and for hair are different
targets; do not score person completeness against a hair-only reference.
The PNG masks quantize canonical floating-point alpha to 16 bits. Tensor records
retain hashes, but raw tensors, canonical mask TIFFs, model weights and scratch
libraries are not part of this portable collection. No credential values or
request authorization headers are retained.

Historical commit IDs in these captures precede the screenshot privacy rewrite.
The [case manifest](../manifest.json) maps them to equivalent published commits;
the captured requests, model bytes and observed masks are unchanged.
