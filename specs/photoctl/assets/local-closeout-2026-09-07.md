# Local closeout verification

The host TypeScript run used all 201 test files with one worker and unchanged
timeouts. It completed in 1071.25 seconds: 1,093 passed, two failed. Unlike the
[disk-exhausted attempt](local-closeout-2026-09-07.log), this run reached a terminal
summary. Rust, Docker and macOS are separate stages; this is not a full gate pass.

## Corrected test contracts

- Retained output must carry the treatment of its selected execution. Equal-quality
  candidates use the documented stable identity tie-break, not evaluation recency.
  The test now compares the selected execution with its independently supplied
  treatment instead of assuming the last decoder run wins. Dropping treatment in
  the production retained reader made the corrected assertion fail.
- Noise reduction must leave the JavaScript event loop responsive. The tiny input
  finished after only two timer ticks in the full run but passed unchanged in
  isolation. The test now uses the sustained workload already used by neighboring
  responsiveness tests, preserving the heartbeat assertion and timeout. Temporarily
  running the actual native grading task synchronously produced one heartbeat and
  failed that assertion.

Both production mutations were reverted and the native addon rebuilt. The two
complete test files then passed all 78 cases. Typechecking, targeted formatting
and lint checks passed. No product behavior, schema or public interface changed.

Review found no additional policy decision: execution selection and asynchronous
grading were already specified. These corrections test those existing contracts.
Independent read-only reviews confirmed both diagnoses. The separate Codex CLI
review could not run: its installed version is incompatible with its configured
model. It supplied no review verdict.

The complete Rust workspace gate passed: nine LibRaw tests and 78 image tests,
with no failures or ignored cases.

## Docker and macOS results

The Docker run exposed a separate harness mismatch: its root process bypassed
the read-only directory in the XMP partial-failure test. A direct filesystem probe
confirmed the write succeeded with default capabilities and returned `EACCES`
without the access-bypass capabilities. The functional Compose service now drops
those capabilities. The original Docker TypeScript run finished in 1227.83 seconds:
1,093 passed and two failed, both XMP permission checks. Both unchanged affected
files pass through the corrected service: six tests, including the built CLI.
Build steps and product code are unchanged. The original full run used its
original capabilities and must not be relabeled as corrected.

The separately executed Docker model gate passed all three tests: real SAM
photographic subject selection and both native-load checks. The temporary server
was stopped after Docker fetched and verified the pinned models; these results
do not establish public model hosting or fine-edge mask acceptance.

The complete host macOS gate passed all 17 tests across seven files in 250.77
seconds on source `b8c283d`. This includes all nine freshly built release-package
cases, both unchanged decoder-oracle modes, deterministic CIRAW, linkage, warm
daemon performance and model-runtime checks. The packed-install file passed in
212.02 seconds. No live provider, mounted-camera or SSH-headless claim follows.

## Remaining acceptance

All named local stages have now executed, but the complete TypeScript runs
preceded their respective test/harness corrections. Preserve the distinction
between those full-run results and the focused correction checks; do not report
a fully green closeout from their combination alone. The final integrated gate
must use the corrected source and container configuration. Photographic and
external release acceptance remain in the owning slice plans.
