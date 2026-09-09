# OpenPhoto decisions

Review the two cost/quality tradeoffs first: integer enlargement can buy more
pixels than fractional resizing, and local compositing guarantees protection but
does not show the provider the exact selection outline. These entries describe
the final implementation, not intermediate plans. No unsound or user-only decision
remains unresolved.

## Sound — medium confidence

### Enlarge by whole-number factors instead of fractional resizing

**When:** provider canvas correction.

When a user edits a 384×384 crop, the model's minimum output area prevents sending
that size directly. OpenPhoto sends 1152×1152, repeating each input pixel across
a 3×3 block. It keeps the source proportions and an exact whole-pixel mapping;
canvas correction does not change the authored selection. A fractional enlargement to roughly
816×816 could cost fewer pixels but would need a different resampling contract.
Already-supported input sizes and bytes are unchanged. Requests that cannot fit
the provider's limits without reducing density fail explicitly.

**Gap:** the plan did not choose a resizing policy for unsupported small crops.
**Reach:** small requests may cost more and retain higher native density than the
requested size; warnings and provenance disclose the actual canvas.
**Verdict:** sound because the mapping is explicit and reversible, rather than a
silent stretch. **Confidence:** medium; lower pixel cost could justify a separately
tested fractional policy later.

### Put declared padding on the right and bottom

**When:** provider canvas correction.

A 1001×1000 image needs a canvas whose axes meet the model's alignment rules.
OpenPhoto places that content at the top-left of a 1008×1008 canvas and fills
the right/bottom margins with black. Very narrow images also receive enough
short-axis padding to satisfy the provider's aspect limit. Centering would add
offsets; extending image edges would invent additional image context. For a new
generation, the prompt asks the model to compose inside the declared content
rectangle before those margins are removed.

**Gap:** the plan did not specify placement or the appearance of added margins.
**Reach:** one coordinate convention serves edited and generated images. Prompt
compliance is not a guarantee of photographic composition or material quality.
**Verdict:** sound because padding is separate from the selected region and its
removal is declared before purchase. **Confidence:** medium; margin appearance can
influence a generative model.

### Keep the requested model and protect pixels with local compositing

**When:** masked-edit transport correction.

When a user selects part of a photo, GPT Image 2 edits the supplied context crop.
OpenPhoto composites through the effective mask coverage and preserves pixels
outside it. Strict fit follows the authored selection; other fit policies can
expand or feather that coverage. The
provider is not trusted to preserve the rest: its native mask did not protect a
test rectangle. Keeping masked editing unavailable was the alternative; changing
models or automatically retrying a failed native purchase was not chosen.

**Gap:** the plan did not select a transport after native-mask verification failed.
**Reach:** this model uses instruction-and-composite requests; native polarity
remains unverified and unknown native profiles still refuse masked requests. The
provider does not see the exact outline. In the strict-fit glass example, a rim
outside the selection is discarded even though protection is exact.
**Verdict:** sound because the application owns the protection contract and names
the strategy in provenance. **Confidence:** medium; semantic quality inside a
selection is a separate limitation.

### Give structured analysis a longer bounded deadline

**When:** auto-enhance verification.

When photo analysis takes about a minute, the CLI allows its response instead of
stopping after 30 seconds. Structured analysis and grounding have a 120-second
per-attempt timeout; image and embedding requests keep their 30-second per-attempt
timeout. Existing bounded rate-limit retries can make the total operation longer.
An explicitly
configured timeout still wins. Extending every provider call would also lengthen
background indexing failures, which this choice does not do.

**Gap:** the plan required finite timeouts without selecting a reasoning-time
budget. **Reach:** analysis can keep the caller waiting longer, without adding
retries or making latency unbounded. **Verdict:** sound because valid responses
can exceed the ordinary request deadline. **Confidence:** medium; the bound is a
tolerance for variable latency, not a promise that every request succeeds.

### Use a catalogued structured-model identifier

**When:** live CLI provider correction.

When a library has no model override, analysis uses `google/gemini-3-flash`, an
image-input model listed in the Gateway catalog, instead of the unlisted exact
identifier `google/gemini-3.1-flash`. Saved library model settings still win.
Runtime discovery could silently choose a different model later; the
implementation instead keeps a fixed, inspectable default.

**Gap:** the plan did not establish a verified structured-model identifier.
**Reach:** default analysis and grounding use the selected ID; no saved settings
are migrated. **Verdict:** sound because the fixed identifier matches the
[official catalog](https://ai-gateway.vercel.sh/v1/models).
**Confidence:** medium; availability remains an external dependency.

### Send image embeddings through the native Google content protocol

**When:** installation and image-embedding correction.

When a photo is indexed, OpenPhoto sends its JPEG bytes and a fixed caption using
the Gateway's native multimodal embedding route. Text search uses the separate
OpenAI-compatible text route. The verified image-content contract belongs to
the native route; dropping the JPEG would embed only the caption and falsely
appear to index photographs.

**Gap:** the plan did not establish an accepted image-embedding wire contract.
**Reach:** image indexing depends on the AI SDK 6 native Gateway protocol and the
verified `google/gemini-embedding-2` model. Another image model needs its own proven
contract. There is no new SDK dependency or catalog migration.
**Verdict:** sound because the image is part of the actual model input.
**Confidence:** medium; the external protocol can evolve.

### Retry an explicit rate-limit rejection, not an ambiguous purchase

**When:** live-runner acceptance policy.

If the provider replies HTTP 429, the normal transport may retry within its
existing finite attempt bound. If a paid image response succeeds, or times out
without a conclusive result, the runner does not restart that mutation. Treating
every HTTP request as a completed purchase would instead disable the existing
rate-limit handling even when the service explicitly refused it.

**Gap:** “never automatically rerun paid mutations” did not distinguish rejection
from an ambiguous or completed purchase. **Reach:** verification uses production
transport instead of a verification-only retry mode; it creates no hard spending
ceiling. **Verdict:** sound because only explicit 429 rejections are retried.
**Confidence:** medium; attempt records are not billing statements.

### Preserve dotenv values rather than its formatting

**When:** saved-credential configuration.

If the private dotenv file already contains another setting, configure reads its
value, replaces the gateway key and atomically rewrites the file. Comments and
spacing are not preserved. Values with quotes or literal backslashes must survive
a parser round trip; an unrepresentable value fails without replacing the old
file. Appending duplicate keys would leave obsolete credentials on disk and make
interpretation ambiguous.

**Gap:** the plan did not require a lossless dotenv editor or define duplicate-key
handling. **Reach:** the file is a value store, not a formatting-preserving
document. **Verdict:** sound because unrelated values survive and superseded
secrets do not. **Confidence:** medium; preserving comments could be a future
convenience without adding another credential store.

## Sound — high confidence

### Record the provider frame and reject unexplained geometry

**When:** provider canvas correction.

If a request declares a 1008×1008 canvas but the service returns 2016×2016, OpenPhoto
retains the raw purchased image and refuses to apply the old crop coordinates.
It does not guess whether the image was scaled or reframed. A matching response
is reduced only to its declared content rectangle, using one shared normalization
path for new edits, generation and refresh. Requests without a frame mapping keep
their previous same-aspect response handling.

**Gap:** the plan did not define how a provider-size correction should appear in
stored provenance. **Reach:** existing JSON request records now carry declared
`provider_output` canvas dimensions and `frame_mapping` source/output rectangles, or
explicit null when no mapping applies. Refresh overwrites that field so it cannot
inherit an obsolete crop. For edits, the input count covers the sent canvas plus
references; generation without image input records zero. The target count tracks
the requested provider canvas, not the cropped working image. There is no database migration.
**Verdict:** sound because geometry and pixel accounting remain inspectable without
regenerating a purchase. **Confidence:** high.

### Identify changed request policies in adapter provenance

**When:** masked transport and canvas corrections.

When someone inspects a purchased image later, the adapter version identifies
which request policy produced it. GPT Image 2 records version 4 for its explicit
canvas policy; unchanged fixture/native profiles keep their own version. Full-frame
and reference-generation prompts remain unchanged for already-supported sizes.
Reusing one version across different request semantics would hide that distinction.

**Gap:** the plan did not specify the versioning consequence of transport changes.
**Reach:** saved pixels remain replayable independently of later request policies.
**Verdict:** sound because provenance distinguishes external request semantics,
without introducing internal protocol negotiation. **Confidence:** high.

### Require evidence that image bytes affect an embedding

**When:** explicit live embedding smoke.

A provider can return a vector of the right length while ignoring an image. The
smoke submits red, blue and the same red image with identical text, and requires
changing the image to have a larger effect than repeating it. Merely accepting a
well-shaped vector would not distinguish image indexing from caption-only output.

**Gap:** transport success alone did not define useful image-consumption evidence.
**Reach:** the opt-in smoke makes three serial requests with no automatic retries,
outside default tests and CI. It records synthetic hashes and bounded numerical
observations, not credentials or provider bodies. **Verdict:** sound because it
checks image consumption, while making no search-quality or segmentation claim.
**Confidence:** high.
