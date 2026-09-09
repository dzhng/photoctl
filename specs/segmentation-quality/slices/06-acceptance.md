# 06 — Production evidence and remaining quality gate

Question: does the built CLI preserve both scope and the accepted detail?
Capture actual hair and entire-person requests on the same portrait, retain
automatic prompts and all decoder candidates, score argmax fixed before viewing.
Person includes visible hair/face/skin/clothing, excludes bouquet/background.
Compare at the supplied reference viewport plus full image and feature crops.

Run original photographic sky/wire/foliage/road holdouts through the same built
path. Preserve their tests and expected intent. An area smoke test cannot certify
fine wires or foliage holes; use compare-screenshots telemetry and an unprimed
screenshot-critique as the final visual check on the complete capture set.
Record a failed quality gate as failed. No cropped best-of composite, manually
rescued prompts, changed class scope or alternate backend to hide it.

The user clarified that exact reference matching is not required for this run:
stop once the practical levers have been tried and the best defensible result,
references and limitations are preserved. A failed generic quality gate remains
a failed quality claim, but can become a documented future improvement rather
than force unbounded research. Do not hide failing cases or pretend the work
was portrait-only. A genuine unavailable input is reported precisely.

Before calling implementation complete: run whole-pass review and audit-choices,
reconcile every decision against code, run `bun run verify` once and the actual
model gate, and update the handoff. No release publication. Archive only when
the revised practical closeout obligations have honest evidence, including any
unavailable live-provider verification.

Delegated: capture presentation and test harness details. Not quality thresholds,
scope, omission of failing cases, or goal completion. Open review shots with
preview-shots while continuing non-blocked cleanup; silence is not visual proof.

Engineering checkpoint, 2026-09-09: the built CLI passes the original sky/road
photographic smoke test through actual native ZIM and persisted mask artifacts
(36 seconds). Area bands remain unchanged. Interior/exterior probes now require
alpha above 0.95 / below 0.05, because the accepted fractional-mask contract
does not guarantee exact binary values. This is not a fine-detail visual verdict.
All eight integrated acquisition/manifest/release-verification tests also pass.

The [actual CLI holdout review](../assets/cli-holdout/critique.md) now records
the complete production sky/road captures. Independent review fails fine-wire,
foliage-gap and foreground-fence exclusion despite the coarse smoke pass.
Keep this gate open; do not relabel the engineering port as generic parity.
