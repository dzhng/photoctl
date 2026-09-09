# Discoverable CLI and completed segmentation verification

The user requested usable root-linked CLI documentation, executable help,
working real segmentation and completion of the previously unavailable live
whole-person capture. They explicitly impose no memory ceiling: runtime sizing
is an engineering responsibility, not an approval blocker. Preserve model
fidelity and selection intent; do not lower resolution or quality to fit a probe.

## Next Agent Prompt

Implement the three contracts below and keep this handoff current. Discovery and
pixel allocation can proceed independently; the main agent owns secrets, live
capture, integration and final verification. Existing unrelated provider-table,
auto-enhance and live-gateway edits belong to another task and must remain intact.

- [ ] [Discovery](slices/01-discovery.md): library-independent help and root-linked usage.
- [x] [Memory](slices/02-memory.md): reproduce and remove unnecessary heap inflation;
      verify the failed Docker real-model workload.
- [ ] [Live evidence](slices/03-live.md): automatic whole-person capture and retained review.
- [ ] Whole-change review, choices consolidation, final closeout and archive.

Memory checkpoint: both isolated pixel consumers failed by heap exhaustion before
the fix and pass after it with identical quantization assertions. Seventeen
focused render tests pass. The real Docker model suite passes all three tests
in 63.76 seconds using unchanged Node heap defaults (reported limit 2,348,810,240
bytes). Independent Codex review found no actionable issues. The final rebuilt
full gate still remains; this targeted run mounted the rebuilt render output
into the existing test image. Continue discovery and the live person capture.

## Owners and boundaries

One command inventory must own dispatch and discovery: no second roster that
silently drifts. Existing command parsers own execution validation. Help is a
read-only schema-1 response through the existing CLI output contract; it never
opens a catalog, starts a daemon, loads credentials, fetches models or calls a
provider. Existing configure/settings help remains usable.

The render color boundary owns float-display-RGB to byte quantization for both
grounding delivery and model preparation. Pixel values and resampling remain
unchanged. Native sessions and their safe tensor ownership are not redesigned.
There is no new heap flag or memory manager unless measurements show it necessary.

Model acquisition remains explicit `doctor --fetch-models`, pinned upstream or
configured mirror, into the selected library. No new downloader or automatic
network request during help, installation or ordinary segmentation.

The evaluation collection owns durable source/target/observation provenance.
Live person scope is visible hair, face, skin and clothing, excluding bouquet
and background. A successful call is not a quality pass, and an observed output
is not ideal alpha. The user's practical stopping condition still permits
documented quality defects after sensible controls, not unbounded model research.

## Verification

Use write-tests tracer-bullet red/green tests at each changed seam, then focused
or changed tests. Rebuild before built-CLI tests. The final gate is one
`bun run verify` with known build/model prerequisites, plus the live capture.
If a stage fails, diagnose it and rerun its affected scope rather than repeatedly
restarting the entire gate. Record exact outcomes.

Use review, independent Codex review and audit-choices before completion.
Live images require compare-screenshots telemetry and an unprimed
screenshot-critique as the final visual judgment. Keep all captured states;
preserve honest failures, never invent missing ideal masks. No publication,
credential persistence, OS changes or unrelated behavior changes are authorized.

## Plan synthesis

Three independent drafts agreed on pre-library discovery, explicit download
lifecycle and separate live-quality evidence. The seam-first proposal informs
one dispatch/discovery inventory; the smallest-plan proposal rules out a new
command framework. The risk-first draft identified full-image typed-array
iterable conversion as a concrete heap-inflation suspect, which must be
reproduced before runtime budgets are changed. No migrations are needed.
