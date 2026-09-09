# ZIM cutover: one engine, preserved selection intent

This ladder implements the authorized noncommercial ZIM adoption. It does not
declare the broader PhotoLab-quality objective complete: the generic holdouts
in [research-gaps](research-gaps.md) remain an acceptance obligation.

## Contracts and ownership

The [choices ledger](choices.md) records decisions made while implementing.

- The structured provider owns normalized provider coordinates → image-frame
  coordinates. Each instance carries its label, locating box and signed points.
  Text describes arbitrary targets, not a hard-coded hair/person taxonomy.
- The command owns instance selection and revision binding. The configured
  segmentation adapter owns base/render-frame conversion exactly once.
- The render package owns ZIM preprocessing, prompt tensors, score-argmax
  selection and the encoded-image cache. The native addon owns ONNX sessions,
  worker lifetime and pixel resampling; no Python service or second worker.
- ZIM output is fractional alpha, never SAM2's binary threshold. Existing
  projection, layer storage, editing and replay remain authoritative. No saved
  mask migration, compatibility backend, new endpoint or database schema.
- Existing manual box/brush commands stay manual. No new correction flag or
  broad/narrow slider in this cutover. Public CLI invocation shapes survive.
- Official ONNX files are acquired by pinned revision and hash. Preserve the
  upstream noncommercial notice. No upload, release or unrelated relicensing
  is authorized by this implementation.

## Dependency graph and review map

| Slice | Depends on | Contract and human review surface |
| --- | --- | --- |
| [00 reference](slices/00-reference.md) | none | Frozen external tensors and real prompt captures |
| [01 acquisition](slices/01-acquisition.md) | 00 metadata | Verified models through existing fetch/doctor |
| [02 grounding](slices/02-grounding.md) | none | Signed, per-instance guidance through one gateway call |
| [03 pixels](slices/03-pixels.md) | 00 | Faithful preprocessing and fractional mask restoration |
| [04 engine](slices/04-engine.md) | 03 | One native runtime and bounded cached features |
| [05 command](slices/05-command.md) | 01, 02, 04 | Actual CLI selection, revision-safe persisted masks |
| [06 acceptance](slices/06-acceptance.md) | 05 | Hair, entire person, generic holdouts, closeout |

Acquisition and grounding can proceed independently of the pixel/engine chain.
Run independent implementation passes in separate worktrees. Review and commit
each focused pass; do not commit the multi-gigabyte research scratch collection.
Retain it locally and keep compact evidence manifests in the plan.

## Verification and open decisions

Use write-tests red/green tracer bullets at each seam. Focused Vitest or Cargo
tests are the feedback loop; rebuild before any built-output probe. Run
`bun run verify` once at implementation closeout, plus the real-model gate.
Do not weaken existing holdout quality or coverage to accommodate a candidate.

Every visual acceptance uses compare-screenshots telemetry against the actual
target and an unprimed screenshot-critique as its last check. Include the
user's reference viewport and full-frame/feature crops. Preview checkpoints
are non-blocking opportunities to course-correct, not inferred acceptance.

The user approved text-plus-click instance selection: text says what kind of
thing and the click says which instance. Slice 05 must select the clicked match,
report no match or ambiguity explicitly, and never apply the click to every
candidate. No new flag is required.
The actual whole-person automatic trial needs the configured gateway key;
missing credentials do not block deterministic local port work.

## Synthesis decisions

Three independent drafts informed this ladder: minimal, seam-first and
Claude risk-first. All agreed on signed guidance, a single native owner,
fractional masks and real end-to-end capture. The risk draft correctly exposed
thread/cache and release assumptions. Its proposed generic profile/threshold
switches and unchanged SAM2 geometry were rejected: there is only one backend
after this cutover, and ZIM requires bottom/right padding and two-stage logit
restoration. No generic profile abstraction is justified.

Automatic text uses signed points without a decoder box, matching the accepted
reference path. The provider box locates the instance; it is not the semantic
mask. Explicit point-plus-box requests preserve both token sets using the
measured combined adapter; do not copy upstream's token overwrite bug.
Model scores choose candidates before inspection. No best-looking candidate,
manual prompt rescue, local crop stitching, MGMatting eyebrow selection,
SAM3 or Apple fallback may make a failed case appear green.

The former research kickoff is superseded by this ladder. Research ledgers
remain evidence, not instructions to rerun rejected approaches. The root
[handoff](README.md#next-agent-prompt) owns current execution status.
