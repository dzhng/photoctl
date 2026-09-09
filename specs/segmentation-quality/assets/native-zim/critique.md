# Native port preserves the accepted portrait appearance

The unprimed reviewer inspected all five states, full overlays and black/white
composites, all six crop regions and the supplied PhotoLab viewport. Main-agent
inspection agrees: A/B, D/C and B/E are visually indistinguishable. B remains
comparable to PhotoLab's shown hair-only scope and prominent curl retention;
this is appearance preservation, not an improvement claim or ideal-matte proof.

## Evidence boundaries

Labels: A is official points-only, B the native port, C native combined points
and box, D the reference combined adapter, E a repeated native points-only
decode. R is the untouched PhotoLab screenshot viewport. All candidates use a
fixed 60% green overlay; reference grading/opacity differ. Black/white composites
diagnose actual alpha but cannot establish PhotoLab's unseen alpha quality.

The [metrics](metrics.json) report maximum alpha differences below 2e-5 for both
reference/port pairs. Their overlays differ at only 31 and 29 pixels, each by
one channel level. The repeated native mask is byte-identical. The
[runtime capture](runtime.json) records one encode, three decodes and all scores;
candidate choice is score argmax, never visual selection. Full raw outputs and
prompt tensors remain in `/tmp/openphoto-zim-port.IwuZPe/native`.

## Inherited defects, not hidden by parity

Lower hanging flyaways end before their visible source endpoints. Some upper
and right fine strands are less completely retained. Black composites reveal
pale background between crown curls and greenish cloudy patches along right
and bottom curls. Some skin between forehead curls and a brown fringe remain;
a tiny isolated facial speck is visible with medium confidence. Dense hair and
major curls remain, while face and flowers are largely excluded.

The supplied viewport does not justify a clear overall win or regression versus
PhotoLab. The lower-strand limitation remains part of the wider quality goal.
Combined-box input here is an authored diagnostic, not an automatic text result.
Whole-person, real CLI grounding and generic holdouts are still separate gates.

All review PNGs are retained beside this report. They contain research extracts
whose redistribution rights are not established; no publication is authorized.
