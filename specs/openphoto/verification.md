# Live-provider evidence

The [opt-in CLI runner](../../scripts/live-gateway.mjs) uses a new disposable
catalog and home, and removes its saved credential on completion or normal
interruption. The explicit live key is never inferred from ambient credentials.
Model files may be linked from an existing pinned installation; the CLI still
checks their hashes. The [fixture tests](../../scripts/live-gateway.test.ts)
exercise the real CLI against a loopback service without developer credentials.

## Accepted boundaries

The [initial real journey](assets/live-gateway/report.json) on 2026-09-09 passed
image embedding, vector retrieval, generation, reimagine, relight and offline
replay. Each purchased image has its own capture and execution provenance.
Replay changed the revision on undo, restored it on redo, used a new preview
cache with credentials disabled, and left purchased execution and attempt
records unchanged. Its decoded pixels were identical; the
[comparison](assets/live-gateway/comparison.json) retains the measurements.

Independent visual review found a coherent red apple and red glass sphere,
without conspicuous seams or malformed objects. Relighting preserved the sphere
and added a small highlight; its lighting change is subtle, not evidence of
strong directional relighting. This is synthetic transport/workflow evidence,
not a general photographic-quality claim.

The initial grounding check was wrong: the mask summary counts *any* positive
alpha, including tiny values outside the visible selection. A
[keyless reproduction](assets/live-gateway/grounding-threshold-reproduction.json)
had nonzero alpha everywhere while selecting only the circle at the CLI's
0.5 click threshold. The runner now retains the mask and uses that threshold
for its nonempty/non-full-frame check; it does not alter the mask's pixels.
The [targeted live grounding result](assets/live-gateway/grounding-report.json)
returned one instance, selected every sampled interior pixel and none of the
sampled exterior pixels. Independent inspection of the
[mask](assets/live-gateway/grounded-mask.png) found close alignment with the
red circle, no visible holes or substantial spill, and minor boundary unevenness.
The failed initial report is retained unchanged, not relabeled as a pass.

## Provider boundary findings

Auto-enhance initially hit the 30-second provider timeout without committing a
develop change. A read-only test of the exact CLI request completed in
[39.4 seconds](assets/live-gateway/analysis-latency.json). Structured analysis now
has a 120-second default cap; image and embedding calls retain 30 seconds, and
explicit overrides still win. A targeted actual CLI check
[passed in 65 seconds](assets/live-gateway/auto-enhance-report.json), with one
[stored analysis revision](assets/live-gateway/auto-enhance-provenance.json).
No successful paid image mutation was repeated to investigate it.

The [native mask probe](assets/mask-polarity/report.json) made one request with
transparent pixels over the left red rectangle and opaque pixels over the right
blue rectangle. The prompt requested both rectangles turn green, so only the
mask could protect the right one. Both turned green. Independent review confirmed
the protected-side change; [measurements](assets/mask-polarity/comparison.json)
show every protected-rectangle pixel changed. The wire mask's sampled alpha was
0 on the left and 255 on the right/background. Native polarity is **not verified**.

GPT Image 2 therefore uses the existing instruction-and-local-composite strategy
explicitly, not an automatic fallback after a failed purchase. This is a transport
correction within the spec, not native-mask verification. Full-frame and
reference-generation prompts are unchanged. The runner now reads the actual
composite/base/mask artifacts and compares every zero-coverage linear pixel,
then verifies masked-result replay without another purchase. Its strict-fit
fixture protects all pixels outside the authored selection; JPEG comparison is
not substituted for this proof.

The first live request on that path was
[rejected](assets/live-gateway/masked-size-rejection.json) with HTTP 400. Its
retained attempt requested 384×384 output. GPT Image 2 requires at least
655,360 output pixels according to the
[official size constraints](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide).
Output-size negotiation and actual live fidelity acceptance remain open.

## Engineering checks

Focused runner, model-resolution and auto-enhance tests pass. Interruption,
escaped-secret redaction, failed-purchase replay and missing capture provenance
each failed before their fixes. The existing bounded-429-retry test passes:
explicit rate-limit rejections are retried; successful/ambiguous image purchases
are not rerun by the script. Batch failures already set `ok: false` in the
[shared response owner](../../packages/commands/src/batch.ts), so the runner does
not add a second batch-status policy.

Saved-key replacement is now tested against the same running daemon PID.
Empty/multiline input and rejected credential arguments preserve the saved file
byte-for-byte and print none of the synthetic secrets. The scoped independent
code review found no concrete correctness or secret-handling defects. The final
full local gate and spec closure remain pending real masked acceptance.
Publication stays paused.
