# Composite allocation lifetime

## Audit before changing the native owner

**P1: full-resolution canvas preprocessing exceeds G6.** The final release addon at
`771e0f7` reaches 4,406,755,328 bytes daemon RSS on the existing 7008×4672 RAW/crop/rotation/
border witness, before encoding. It returns the exact historical mask, then the unchanged
3 GB early-stop rule ends the run. A matched old-ORT release witness also fails (4,702,388,224
bytes): the new runtime is not required to reproduce the breach. The older passing debug
trace is not a matched release-profile comparison.

The shared support projection uses a zero RGB base with ordinary fractional compositing.
At 4328×6728, one RGB buffer is 349,425,408 bytes and one mask is 116,475,136 bytes.
The native compositor snapshots two RGB buffers and the mask (815,325,952 bytes), then
clones its already-owned base again for output. The task snapshots were not reported to
Node's external-memory counter. These are bounded frame-sized allocations, not a retry loop
or growth with edit history. The exact public resource witness remains the acceptance seam.

A passive automatic-GC diagnostic reaches 4,478,156,800 bytes with the same mask. Fourteen
major collections occur before encoding; backing-store bytes subsequently fall while RSS
remains high. This dismisses the claim that no GC occurred. Freed storage can remain resident;
accounting correctness and less allocation do not guarantee a particular process RSS.

## Preserved contract

Ordinary compositing consumes its owned base vector as output without another RGB clone.
The existing `TaskMemory` owner accounts all actual composite-task vector capacities; the
base charge transfers to Node's output backing store, while the other charges last until
task disposal. Lift and overlay share this task ownership but keep their existing arithmetic.
Lift no longer allocates an unused background vector: its algorithm never reads a background.
Lift is not a substitute for fractional compositing: it retains unpremultiplied RGB for every
positive mask value, and its signed-zero behavior differs. No native JavaScript API changes.

The native allocation regression first fails on the redundant clone, then passes alongside
exact Float32-word checks. Public native tests preserve zero/fractional/full coverage and
caller snapshots even when all three arrays are mutated after invocation. Replacing the
interpolation with lift-style copying falsifies those pixel checks. Separately, removing
task charges makes the pending counter regression fail; transfer and rejected-input checks
cover composite, overlay and lift. Counter checks reuse the existing test-only GC diagnostic;
resource measurements never force collection or tune the allocator.

## Full-resolution result: still red

The [corrected release-addon witness](composite-resource.json) reaches 4,159,832,064 bytes RSS,
so the unchanged early-stop rule ends it after one successful request. The exact historical
mask is preserved; the one encoder execution takes 1,381 ms. The same full source, crop,
rotation, border, frozen models, observer intervals and ordinary allocator are retained.
The daemon stops normally. The addon hash is unchanged before/after the run. This isolated
build uses the old default ORT archive, matching the old-runtime release control; root's
corrected source-built ORT is not part of this candidate binary.

The allocation/counter correction is verified, but it does not close G6. Single-run RSS
differences are not a stable ranking or an isolated estimate of either variable's benefit.
The shared projection's zero-background allocation, ordered transform outputs and clipping
buffers remain separate work; no projection, model, sampling or timing policy changes here.
The fresh harness, commands and complete native-boundary trace are retained under
`/private/tmp/photoctl-g6-composite.ST28LS` for the next bounded investigation.

After the unused lift background was removed, the [final binary recheck](composite-final-resource.json)
is also red at 4,693,262,336 bytes, with the same exact mask and one 1,085 ms encode. It stops
after the first request and exits cleanly. Its complete trace is retained in
`/private/tmp/photoctl-g6-composite-final.RdUkUb`; before/after binary hashes agree. The resource
journey does not call lift, so this run-to-run spread reinforces why byte-allocation savings
must not be presented as a measured RSS guarantee.
