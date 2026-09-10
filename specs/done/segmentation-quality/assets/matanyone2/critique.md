# MatAnyone 2 — native-resolution refinement evidence

The fixed person and hair-only probes execute successfully on Apple MPS, but
neither establishes the requested boundary quality. Hair-only is outside this
human-matting model's documented target. Keep runtime feasibility separate from
quality and from permission to adopt the dependency.

## Fidelity

The unmodified official source was inspected at commit
`0079197acd6d16a741f71558809c06c586c579e0`. The release checkpoint is
`v1.0.0/matanyone2.pth`, SHA-256
`5e9821e4087231427376b437c85bb6e072b41e582314f06fd524f75bc4af5914`.
The [instrumented runner](run_one.py) calls the official still-image wrapper:
two identical original-resolution frames, ten warmups, thirteen core steps,
zero seed morphology, fresh state for each target, final floating prediction.
Every intermediate is retained; no favorable intermediate was selected.
The [checkpoint audit](person/checkpoint-audit.json) and strict loading establish
complete state before suppressing redundant pretrained-backbone initialization.

The [runtime record](summary.json) owns versions, device assertions and timings.
This is Python 3.12 / torch 2.8 / torchvision 0.23, not the official CUDA lock's
2.10 / 0.25 environment. The [setup record](setup-record.json) explains that
departure. Both runs preserve 1614×1080 inputs with native padding, FP32 MPS
execution and no CPU fallback or internal size cap. Synchronized core inference
was 6.51 seconds for person and 2.96 seconds for hair; total fresh-process times
were 38.63 and 5.30 seconds, with cold imports dominating the former. Peak MPS
driver allocation was 6.522 GB, distinct from roughly 1 GB process RSS.

## Visual contract and findings

All candidates share source coordinates. Composites use fractional alpha on
black/white and a green selection overlay; no thresholding, cleanup or foreground
color reconstruction is applied. The [hair capture report](review/hair/capture-report.json)
and [person capture report](review/person/capture-report.json) own fixed crops,
neutral label mappings, alpha differences and edge telemetry. Differences are
not accuracy scores; the source photograph determines whether content is lost.

- Hair: forehead curl openings are cleaner than native SAM 3, and the main curl
  stays more opaque than ZIM. Some skin islands remain. The right-hand curl tip
  is truncated, and the lower hanging curl network is almost entirely missing.
  ZIM preserves more real outer/lower hair, despite its haze and incomplete
  exclusion. Flower exclusion remains intact.
- Person: the refiner softens the coarse SAM 3 boundary and removes isolated
  clothing flecks, but does not recover the white garment left of the arm.
  Lower flyaways remain missing. Apple preserves more fine hair there but selects
  the bouquet, violating the explicit person-without-flowers scope.
- Top edges improve over the binary seed, yet filled pale spaces and missing
  fine strands remain visible against black. Softer boundaries are not parity.

An unprimed reviewer inspected all sixty neutral comparison images, covering
both full views and every supplied crop in all four display modes. Its ranking
was ZIM > MatAnyone 2 > native SAM 3 for hair, and MatAnyone 2 > native SAM 3 >
Apple for person under the explicit flower-exclusion contract. Neither passes.
The independent review confirms the missing lower curls and garment, and also
flags near-erasure of the isolated upper-left crown loop in the refined person
mask. Main-agent crop inspection confirms that loss. It flags a small gray alpha
depression in ZIM's crown at medium confidence; the source does not establish a
clear background hole there. Preserve that caveat rather than treating the
preferred comparison as ground truth.

## Evidence ownership

[Hair overview](review/hair/named-full-overlay.png),
[forehead curl](review/hair/named-face-white.png),
[lower hair](review/hair/named-bottom-black.png), and
[person overview](review/person/named-full-overlay.png) provide the compact human
comparison. The complete neutral and named capture sets are retained in `review/`.
The [archive manifest](archive-manifest.json) verifies exact copies of every
prediction, capture and run record; model weights and environments are not vendored.
The [capture script](capture_review.py) records rendering, and
[archive script](archive_evidence.py) records retention. The source license is
S-Lab 1.0; commercial adoption remains unresolved and is not implied by this probe.
