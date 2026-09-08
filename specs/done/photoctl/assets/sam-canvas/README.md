# Source-only canvas input

The model must see the photograph in the current physical canvas, with hidden original pixels
remaining hidden and photographic layer pixels omitted. The canvas may have finer sampling in
`show` because a generated border supplies native pixels; those pixels cannot increase source-only
SAM sampling. Current color adjustments still apply before the shared ordered projection.

These are decoded JPEGs from actual text-grounding HTTP requests through public dispatch. The
local HTTP fixture returns no grounded instances, so this capture performs no inference or external
provider work. The independent command tests capture real encoder tensors and decoder prompts.
Both sets use the same asymmetric 16×12 gradient, source, mutations and JPEG encoder:

| State | Intent | A input | B input |
| --- | --- | --- | --- |
| a | Crop and quarter-turn, no canvas | 4×8 | 4×8 |
| b | Add border around that crop | 4×8 | 8×12 |
| c | Increase exposure after border | 4×8 | 8×12 |
| d | New crop/border, remove earlier border | 8×4 | 12×8 |
| e | Same surviving canvas, half-size offline source | 4×2 | 6×4 |

A restores the former command behavior by omitting the snapped canvas plan; B uses the shared
projection and support owner. The no-canvas control is byte-identical. Every changed state differs
in dimensions and bytes. Resizing the pairs to compute a same-size distance would erase the
sampling contract, so the evidence retains native dimensions, hashes and per-image scene metrics.
Each native image has a 24× nearest-neighbor zoom: the tiny raster is the thing under inspection,
not a simulated high-resolution photograph. Whole-image zooms include every boundary.

Dark canvas is intentional source exclusion, not lost photographic border RGB. JPEG ringing and
chroma leakage remain visible; the exact-black claims are asserted separately before JPEG encoding
at the real encoder edge. The low entropy in the later states reflects a small admissible source
island in a mostly black viewport. All captures are opaque. None of this is photographic mask or
seam-quality acceptance. The complete outpaint visual journey still belongs to 12f3.

## Verification

The affected command/render run passes 73 tests, with TypeScript build/typecheck. Public regressions
prove current color adjustment, consumed-crop placement, inherited exclusion after removal, original
coordinate prompts, reduced source-only grounding, and dry-run revision preservation. Falsifications
respectively restore the old command path, omit inherited base stages, and bypass current grading;
each fails on the intended observable contract before the implementation is restored and green.

The per-image facts are in `a/capture.json`, `b/capture.json` and their scene metrics. The
[review disposition](critique.md) records the fresh critique, exact codec witness and code review.

## Full-resolution resource witness

A separate public CLI witness used the local 7008×4672 ARW, crop [200,200,6600,4200],
quarter-turn and a synthetic 64-pixel border. The source-only frame was 4328×6728 with
base-to-raster matrix [0,1,-1,0,4464,-136]. Three requests on one persistent daemon returned
the identical mask hash. Peak process RSS was 2,562,588,672 bytes, below the 3,000,000,000-byte
limit; the single encoder call took 1,389 ms, below 4,000 ms. No forced GC, provider request,
request downsampling or allocator tuning was used; the daemon stopped normally. This is a
representative resource witness, not a universal memory bound or photographic mask-quality claim.

The first attempt exposed an idle-transport failure: the client reported unknown outcome after
32.6 seconds, while the daemon finished and committed. Public layer inspection confirmed that
revision before an explicit undo in this disposable witness library. It was not automatically
retried. Existing five-second advisory progress now covers model initialization through commit,
and segment receives the same 31-second minimum idle window as other heartbeat commands.
The following three requests succeeded, including requests longer than the old idle window.
The report records both attempts in [resource.json](resource.json).
