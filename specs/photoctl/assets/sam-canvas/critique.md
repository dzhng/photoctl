# Source-only canvas review

## Target and direct inspection

The source island keeps its authored placement inside the current viewport. Exterior or previously
excluded source pixels are black; generated photographic layers are not input. Current exposure
changes the source island. Removing an inner border cannot reveal source pixels excluded by the
surviving border's authoring history. Offline pixels may reduce sampling without changing the
physical viewport. The no-canvas control stays unchanged.

The implementing agent inspected all 20 native/zoom captures. A/a and B/a match. B/b and B/c
retain the central upright source island with visible border on all four sides; c is brighter.
B/d retains only the admissible original island rather than exposing A/d's left-hand content.
B/e represents that same island at half sampling. These are deliberately tiny synthetic frames,
not evidence of photographic subject quality. Black borders, low entropy and sharp island boundaries
are required by this input contract.

## Fresh image-only critique

Independent session `01a07401-4812-7472-9266-87b44077a41b` received all 20 images, neutral A/B labels,
native dimensions and the zoom convention, but no implementation or desired verdict. It reported:

- High confidence: state a is visually indistinguishable.
- High confidence: b/c have larger dark canvases and approximately 4×8 central islands, with
  altered saturation/contrast, a pale left edge and faint colored halo pixels.
- High confidence: d has a smaller approximately 6×4 source island and e approximately 3×2,
  with muted chroma versus their full-frame counterparts.
- Tiny native resolution prevents judging semantic content or interpolation quality; nearest-neighbor
  blockiness alone is not a defect. Framing, occupied dimensions and surrounding pixels are visible.

Disposition: the framing and excluded content agree with the target, not the old route. The color
and halo observations are real and are not dismissed as invisible. A controlled codec witness builds
the b-state input independently from the known source byte gradient, copies its 4×8 rotated source
island into an otherwise zero 8×12 RGB buffer, then applies the same JPEG encoder. All 288 decoded
channel samples exactly equal the captured B/b request (maximum and mean difference zero). Thus
the visible b-state chroma/ringing does not establish a projection defect: the same effect exists
with an independently assembled exact input. The current JPEG transport remains unchanged, and this
does not claim that codec loss is desirable or that other photographic inputs have acceptable quality.
The encoder-edge tests separately assert pre-JPEG black and mapping, where JPEG loss cannot hide errors.

Verdict: accept the source-only geometry and sampling correction; do not infer photographic quality
or the final outpaint lifecycle acceptance. The complete later journey remains open.

## Code and behavior review

Independent code review `01a07400-2fb1-7922-a2eb-d86a659d37a3` found no actionable correctness issue.
Its typecheck passed and 25 canvas cases passed; the local HTTP listener was denied by its sandbox.
The unsandboxed implementing run passed all 73 affected cases, including that HTTP grounding test.
The review also invoked a broad build while attempting package filters; that build is not counted
as a successful native/release gate. No additional native source was changed.

The local shape review extracted only the existing ordered base projection/support mechanism and
the geometry-field exclusion used by both real consumers. Develop and canvas plan now come from
the same immutable active-state snapshot. No schema, renderer semantic revision, configuration,
dependency, provider call, or segmentation threshold changed.

Second review `01a0740c-e0db-7cb3-9058-1e176338f3c8` checked snapshot coherence and progress
lifecycle; commands typecheck passed. It requested cancellation before commit after progress
disconnect. Disposition: not adopted. Progress is advisory, as in existing generate/show; a sent
mutation already has an unknown outcome after disconnection. Original warning emission remains
unchanged and may still reject. The new heartbeat neither cancels nor retries mutations. Mask
publication still uses the existing active-revision CAS. Adding cancellation ownership here would
change the established contract, and would not eliminate disconnect races around commit.

The slow-initialization regression and zero-queue idle-window regression both failed before the
heartbeat fix; all 23 focused progress/transport/segmentation cases then passed. The rebuilt public
full-resolution resource witness passed three same-daemon requests with exact mask identity.
Five enlarged candidate captures were offered in one Preview window; that nonblocking checkpoint
was closed after more than five minutes with no user feedback. Direct inspection and independent
critique, not silence, supply the visual evidence.

The parent review distinguished publication CAS from the preparation snapshot. Real CLI requests
are serialized by the daemon or exclusive library lease, but shared-handle dispatch can be reentered.
A public regression committed another selection inside the inference callback and exposed a stale
third layer. Segmentation now captures the nullable initial revision; the existing document
initialization owner accepts an optional expected revision and propagates a lost initialization CAS
instead of returning another writer's winner. Mask publication checks the ensured revision before
using its ordinary final CAS. Omitted expectations preserve other callers' behavior. Both initially
empty and existing documents reject the stale inference without adding its layer. Dry-run and
empty grounding still create no graph rows. A concurrent strict-initialization test fails when the
old winner-return behavior is restored (two successes instead of one); the production guard is restored.

Root integration directly inspected all 20 native/zoom images and agrees with the framing/codec
disposition. The merged Node suite passes 75 canvas, segmentation, store, progress, client and frame
checks, with TS build/typecheck. Exact surviving layer IDs and the competing writer's active hash
remain intact in both initially empty and existing-document race cases. This is consumer closeout,
not the full release gate or final outpaint journey.

Final independent review `01a07418-dbe1-7fc0-b68b-f299722eb79b` found no actionable issue in nullable
initialization, unchanged callers, publication CAS or snapshot coherence. Its strict initializer
test passed; its Bun native-dependent command test crashed, so that run is not acceptance evidence.
The authoritative Node run passed 74 tests across canvas, segmentation, store, progress and daemon
transport. Parent directly inspected all 20 images and agreed with the geometry/codec disposition;
parent test review tightened races to exact surviving public IDs and active revision/hash identity.
