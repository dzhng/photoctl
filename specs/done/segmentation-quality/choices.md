# Implementation choices

Review first: the diagnostic memory allowance, test-file worker budget and
photographic confidence thresholds have medium confidence. All entries below
are settled sound choices; no unsound or needs-user entries remain.

## Sound — medium confidence

### Allow 10 GB peak memory in the native diagnostic

**When:** engine cutover, slice 04.

**Choice and scenario:** Selecting successive photos with ZIM's accepted ViT-L
model produces a larger temporary working set than selecting one cold photo.
The diagnostic therefore permits 10 billion bytes of peak resident memory—the
process memory held in RAM. Its 16-run synthetic-image measurement peaked near
9 GB, returned identical masks, and showed memory dropping again later. Keeping
the earlier 8 GB estimate would reject that measured repeated workload.

**Gap:** The plan required measurement but left the replacement model's
operational allowance open, separately from image-quality acceptance.

**Reach:** This is an explicit diagnostic allowance on the 48 GiB acceptance
Mac. It does not establish low-memory compatibility, whole-command memory use
or universal absence of leaks. The probe still fails an overrun; production gains
no forced garbage collection or additional cache.

**Verdict:** Sound. The [retained runtime measurements](assets/zim-contract/runtime-budget.json)
support a large working set without observed growth across photo history.
**Confidence:** medium.

### Run at most two test files concurrently

**When:** practical closeout, `f254918`.

**Choice and scenario:** One test file can start several real CLI processes and
databases. Starting seventeen file workers based on CPU availability consequently
starts much more than seventeen pieces of work, causing tests to exhaust their
unchanged deadlines. The shared Vitest configuration now schedules at most two
files together. Tests that deliberately exercise simultaneous clients still
create those clients.

**Gap:** The inherited CPU-based default did not account for work launched inside
each file.

**Reach:** Local and CI invocations using this configuration inherit the limit;
an explicit command-line override remains possible. This changes test scheduling,
not product threading or timeouts. Unlike raising deadlines or omitting cases,
it preserves the existing checks.

**Verdict:** Sound. Bounded scheduling addresses the observed contention, but
two workers is a conservative setting rather than a demonstrated throughput
optimum. **Confidence:** medium.

### Test confident photographic coverage without requiring binary alpha

**When:** photographic smoke acceptance.

**Choice and scenario:** An independently authored interior sample returning
`0.99999994` represents effectively complete selection but fails a check demanding
exactly `1`. The photographic smoke test now requires greater than `0.95` inside
and less than `0.05` at authored exterior samples. Alpha—the fraction of a pixel
selected—remains fractional; authored area limits remain unchanged. Exact binary
checks would reject fractional masks; looser confidence limits would permit
less decisive inclusion and exclusion.

**Gap:** The plan required fractional masks but did not specify the old binary
test's confidence thresholds.

**Reach:** Future models must confidently include and exclude these samples.
Passing them still says nothing decisive about fine wires, foliage gaps or hair
boundaries; those retain separate visual evidence.

**Verdict:** Sound. The thresholds preserve sample intent without requiring
discarded binary semantics, and were chosen before rerunning the fixture.
The exact 95%/5% boundary is a judgment about sufficient confidence, not merely
a floating-point precision correction. **Confidence:** medium.

## Sound — high confidence

### Convert points only for the segmentation response contract

**When:** signed grounding, slice 02.

**Choice and scenario:** When the provider locates objects for segmentation, its
`points` coordinates use a 0–1000 image scale and become pixel indices before
reaching the caller. If another structured request returns a field named
`points`, such as an annotation `[250,750]`, those numbers retain that request's
meaning. Converting every matching field name would silently move unrelated
annotations.

**Gap:** The shared structured-response adapter already served other schemas;
the plan did not specify how to scope its new point conversion.

**Reach:** The requested segmentation schema's name selects this interpretation.
Other features can continue defining their own point semantics without a new
public option or parser framework.

**Verdict:** Sound. Conversion follows the requested contract.
**Confidence:** high.

### Include the upstream directory in model identity

**When:** acquisition, slice 01.

**Choice and scenario:** Downloading the pinned ZIM revision also requires its
`zim_vit_l_2092` subdirectory; using the revision's repository root returns 404.
The authored manifest therefore records optional `source.directory`. An
explicitly configured mirror still serves flat `encoder.onnx` and `decoder.onnx`
names.

**Gap:** The plan pinned the upstream source but did not name its directory
within that repository.

**Reach:** Future model updates must preserve the actual repository location.
The additive field also appears in generated release `models.json`; manifest
schema remains `1`. This creates no catalog migration or alternate URL registry.

**Verdict:** Sound. The upstream listing and successful download establish the
required location. **Confidence:** high.

### Stream downloads and hashes through the existing acquisition owner

**When:** acquisition, slice 01.

**Choice and scenario:** Downloading the 1.24 GB encoder previously retained
whole-file buffers. Acquisition now follows: `stream into temporary file and
hash → verify complete hash → publish that file`. Cache inspection also hashes
a stream. If either model download fails, acquisition aborts the companion
request and awaits both cleanup paths before returning the original error.
Returning immediately could leave the other download writing a temporary file.

**Gap:** The plan required safe publication but left byte transport and
companion-request cleanup unspecified.

**Reach:** Retained transport memory no longer scales with model size.
Publication remains atomic per file, not a transaction covering both files:
a successfully verified companion may already be published when another fails.
Failed files do not replace their previous destinations.

**Verdict:** Sound. Memory and interruption regressions support bounded transport
and cleanup before return. **Confidence:** high.

### Author model identity once and generate release copies

**When:** acquisition, slice 01.

**Choice and scenario:** Updating the model now changes the library's pinned
manifest, which both doctor and release preparation consume. After verifying the
distributed files, release preparation writes `models.json`. Maintaining a
separate authored fixture manifest would let runtime and release identities drift.

**Gap:** The retired exporter previously produced two manifest copies; official
ONNX acquisition no longer required that arrangement.

**Reach:** One authored identity controls runtime acquisition and generated
distribution metadata. Explicit custom manifests remain available for
deterministic acquisition tests.

**Verdict:** Sound. This preserves the planned single owner.
**Confidence:** high.

### Validate selection clicks through the existing prepared-image geometry

**When:** command cutover, slice 05; clarified and approved during implementation.

**Choice and scenario:** A user selects an object with text plus a click near a
rotated crop edge. The component already preparing the model's image receives
both the text-request indicator and the original clicks. It validates the center
of the sampled base-image pixel against the crop before requesting grounding.
The finished mask then resolves the click; the click never becomes automatic
model guidance. Testing the raw integer corner could incorrectly reject a
covered pixel at a rotated edge.

**Gap:** Separating instance selection from decoder prompting removed the old
route through crop validation. A new geometry service would duplicate knowledge
already held by image preparation.

**Reach:** The internal setup request now carries text intent and points.
Explicit decoder points retain their original coordinate meaning; decoder
requests independently declare base-image or rendered-image space for their
geometry.

**Verdict:** Sound. Rotated-crop regressions support matching validation to the
sampled pixel and converting guidance once. **Confidence:** high.

### Report unresolved selection clicks through the existing error envelope

**When:** command cutover, slice 05.

**Choice and scenario:** A first click selects one mask, but a second misses
every mask. The command returns a `usage` error with reason `no_match`, the
original second point and a readable message; it creates no revision. A click
hitting several masks similarly reports `ambiguous_match`. Returning only the
photo ID would hide the explanation because the dispatcher uses explicit error
data when present.

**Gap:** The plan required clear failures without defining their structured
fields.

**Reach:** Callers can distinguish missing from ambiguous selection inside the
existing response envelope. Successful mask storage and summary semantics remain
unchanged.

**Verdict:** Sound. The response explains the unresolved selection without
guessing an instance or adding another response API. **Confidence:** high.

### Count photographed scenes independently of render variants

**When:** reference collection.

**Choice and scenario:** Cropping the PhotoLab portrait or duplicating it for an
instance diagnostic produces more test images, but not another photographed
scene. The collection therefore records two evaluated scenes: that portrait and
the A7C II landscape. Additional camera photographs are proposed evaluation
inputs, with no invented results or expected masks.

**Gap:** Numerous experiment names and derived images could otherwise inflate
apparent scene coverage.

**Reach:** Later work can add crops and results without overstating diversity.

**Verdict:** Sound. Scene identity remains tied to the source photograph.
**Confidence:** high.

### Preserve exact evaluated pixels and compact review results

**When:** reference collection.

**Choice and scenario:** Revisiting a landscape mask requires the developed PNG
that actually produced it. Rendering its RAW again, or substituting the embedded
JPEG, may change pixels. The collection therefore keeps that exact PNG, the
distinct historical embedded JPEG, existing 16-bit alpha images and small review
captures. It omits large floating-point mask TIFFs, model features and scratch
libraries while recording canonical mask hashes.

**Gap:** Durable comparison required exact inputs, but indiscriminately copying
experiments would add gigabytes of intermediates.

**Reach:** Sources and observations remain reviewable offline. The 16-bit alpha
images are quantized review records, not lossless replacements for canonical
masks; hashes identify omitted bytes but cannot reconstruct them.

**Verdict:** Sound. Retention preserves comparison evidence with explicit replay
limits. **Confidence:** high.

### Keep visual targets separate from observed outputs

**When:** reference collection.

**Choice and scenario:** A future reviewer compares the PhotoLab green hair
overlay with ZIM's result. The overlay documents desired appearance, while the
ZIM alpha and native composite document measured output. Because the original
PhotoLab alpha is unavailable, neither subtracting differently graded frames nor
choosing the preferred ZIM output produces an independent ideal mask.

**Gap:** "Ideal outputs" could conflate a visual target with ground-truth pixel
coverage.

**Reach:** Future evaluations inherit honest evidence labels. Local retention
also remains distinct from permission to redistribute the references.

**Verdict:** Sound. The collection preserves what each artifact can establish.
**Confidence:** high.
