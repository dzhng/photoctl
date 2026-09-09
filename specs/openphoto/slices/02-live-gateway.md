# Explicit real-provider integration

One opt-in script drives the actual CLI against a disposable library using the
saved-key path. It covers the provider boundaries: image embedding and text search,
structured photo analysis/grounding, generation and editing. Use existing smoke
scripts where they establish a distinct contract; do not relabel canned fixtures
as real-provider evidence. Unsupported operations fail visibly rather than skip.

Test script orchestration with a loopback gateway before spending. Run the real
journey only with the authorized credential, without logging it or sending it
to the test fixture server. Record stage outcomes, selected models, execution
identities and output-artifact validation. Verify undo/redo of purchased results
without another purchase, and report mask polarity separately from strict local
compositing fidelity. Keep source photos read-only and retain reviewable outputs.

Internal script layout, minimal fixture and scenario ordering are delegated.
When an output image is used to claim visual correctness, run compare-screenshots
against its input/contract and an unprimed screenshot-critique before accepting it.
No speculative provider compatibility or new platform work; reproduce an actual
failure before changing transport. Finish with the existing full local gate once.

## Remaining verification boundaries

The opt-in runner must not inherit ambient credentials, and normal interruption
must terminate its active CLI child, remove its disposable saved key and retain
terminal evidence. Redact strings before JSON serialization, including failure
details. A successful batch envelope cannot hide failed items.

Each purchased stage retains a decoded image and its execution/model provenance
before another mutation changes the photo. Replay must start from an identified
purchased result, show undo changing the revision and redo restoring it, and
prove identical pixels with no additional purchased execution or attempt. Use a
fresh cache and disabled credentials for replay. Failed prerequisites cannot
be relabeled successful evidence.

Grounding and masked editing need explicit scenarios, not inference from
auto-enhance or full-frame edits. Reuse the native mask-polarity smoke to establish
the external mask convention before changing its unverified production profile;
test application-enforced outside-mask fidelity separately. Do not add a fallback
provider just to make a probe green. Preserve all actual responses and visual
limitations honestly.

Run each paid CLI mutation once. Existing transport retries of explicit HTTP 429
rejections are not retries of a successful or ambiguous purchase; test and record
that distinction. Never rerun an entire successful paid journey just to retry one
failed stage. Publication remains paused while this spec is finished.
