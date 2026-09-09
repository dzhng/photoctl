# CLI discovery and reliable segmentation boundaries

OpenPhoto exposes command discovery before a library exists and documents the
editing workflow from the root README. Full-resolution segmentation avoids an
unnecessary JavaScript sample list, and automatic grounding names its coordinate
axes explicitly. The work also retains actual live person and hair evaluations,
including failures that execution tests cannot detect.

## Discovery is not execution

An agent should not need a catalog, credentials or a running daemon to discover
how to create and use them. Root, command and nested help therefore resolve
before credential loading and library transport. JSON remains the default
machine interface; human rendering preserves runnable shell quoting.

The [command inventory](../../../packages/commands/src/dispatch.ts) owns both
existing execution adapters and descriptive help. A second command list would
drift, while replacing all existing parsers would add unrelated risk. Handler
parsers retain execution validation. Configure and settings keep their existing
specialized help bodies; daemon control keeps its transport owner.

The [CLI guide](../../../docs/cli.md) explains workflow and coordinates rather
than copying the command inventory. It connects import, inspection, edits,
history and delivery, and separates local model provisioning from gateway
credentials. ZIM acquisition remains explicit through doctor, using the pinned
NAVER/Hugging Face source or a configured mirror; this follow-up adds no downloader.

The [built-CLI tests](../../../apps/cli/src/help.test.ts) exercise discovery with
absent libraries and unreadable credential locations, plus examples whose shell
quoting or nested syntax had initially been wrong. Help must remain independent
of runtime state even when execution paths gain new prerequisites.

## Keep image samples in image buffers

The Docker failure came from full-image iterable conversion before inference,
not a mask assertion: converting floating-point samples through `Uint8Array.from`
temporarily expanded them onto the JavaScript heap. A directly allocated byte
buffer preserves the same clipping and rounding without that intermediate list.

The [render color owner](../../../packages/render/src/color.ts) supplies this
conversion to both encoder preparation and text grounding. Native sessions,
tensor ownership, resolution and mask restoration remain unchanged. The same
Docker model workload passes with its original heap default; no new process
heap setting or user memory ceiling was introduced.

The [allocation regressions](../../../packages/render/src/segmentation-memory.test.ts)
use a deliberately small subprocess heap to distinguish compact pixel buffers
from accidental boxed allocation. That test instrument is not a product memory
requirement. Required image/model storage and JavaScript heap are different
costs; neither should be confused with a quality threshold.

## Name axes at the external boundary

The first live person response aligned with intended objects when read as y/x,
despite a description requesting x/y. Interpreting it as promised selected the
bouquet instead of the woman. Named `at: { x, y }` coordinates now cross the
provider wire. The [structured adapter](../../../packages/providers/src/adapters/structured.ts)
converts them once to the existing internal pixel pair; old ordered pairs fail
instead of being guessed or heuristically transposed.

CLI coordinates, signed internal points, boxes, saved masks and other structured
schemas retain their meanings. Text describes a target; text plus a click chooses
an instance from the projected masks. Format validation cannot prove that the
provider chose good points or that the model retained every requested region.
The [consumer tests](../../../packages/commands/src/segment-text-fake.test.ts)
pin the crop, instance and revision boundaries independently of live quality.

## Preserve what the real run revealed

The [live reference record](../../../fixtures/segmentation/portrait/photolab/live/README.md)
is the source of truth for exact inputs, automatic guidance, scores, observed
masks and independent visual verdicts. It keeps the first failed person request,
the named-axis person request and a separate hair control. Sources and model
outputs are never relabeled as ideal alpha.

Named axes correct the obvious point interpretation, but the person mask still
omits most hair and clothing. The hair control retains broad intended scope with
boundary halos, background gaps and small residue. These are retained evaluation
failures/limitations, not hidden by passing command or area checks. No manually
rescued prompts, visually substituted decoder candidate or composite winner
makes a failed case appear successful.

The [verification record](verification.md) owns the actual gate outcomes.
The [choices ledger](choices.md) explains the architectural decisions left to
the implementer. No credentials, publication, catalog migration or alternate
segmentation backend is part of this change.
