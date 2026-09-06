# Full-frame authored placement candidate

The target is an asymmetric photographic viewport whose generated pixels stay attached
to their original coordinates when the crop changes. Strength is one linear blend,
and removal restores the same available source execution without provider work.

`candidate/` contains the complete four-state capture from the public command witness;
`crops/` shows every state enlarged by nearest-neighbor sampling so individual pixels
remain visible. The before/generated views are the authored crop after a quarter-turn.
The expanded/restored views share the wider original viewport. Cross-size comparisons
are for placement, not direct image distance.

`comparison.json` records a changed candidate: all 240 authored pixels change, while
exactly those 240 of 1,200 pixels change in the expanded view. The other 960 pixels
remain exact. `telemetry/scene-metrics.json` locates content and confirms no transparency;
metrics do not decide whether the placement is correct. Direct inspection finds the
generated rectangle attached to its authored footprint, with the expected inverse
quarter-turn and no spill into the surrounding asymmetric source.

Independent visual review `01a074fc-0263-7591-b7fd-191f8b9418bd` inspected all eight
full/enlarged PNGs and found the patch anchored, consistently rotated and unclipped,
with no visible gap or loss on restoration. Main inspection agrees. This accepts
synthetic placement/support only, not photographic or provider aesthetics. A fresh
read-only CLI reviewer was used after the team reviewer limit rejected dispatch.

Focused evidence: 14 checks across the public geometry/input/strength/failure witnesses,
the existing reimagine lifecycle/upscale neighbors and the built CLI journey pass with
Node 24 / Vitest and two workers. Typecheck, scoped lint and formatting pass. The pre-pass
creation owner fails three selected witnesses for the expected crop/pinned refusal and
wrong transmitted photographic input; restoring the owner makes all focused checks green.
An independent static CLI review found no actionable Pass A issue. No native build,
root suite, packed refresh lifecycle, live paid call or camera read was run in this pass.

The remaining refresh, retained-only source selection and packaged offline lifecycle
belong to the next pass; reduced pinned-source generation does not establish those claims.
