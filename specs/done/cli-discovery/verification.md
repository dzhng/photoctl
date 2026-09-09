# Verification — CLI discovery follow-up

The required engineering coverage passes across the initial gate and targeted
retries. This is not a claim that the first top-level invocation was green, or
that passing execution tests establishes whole-person or fine-edge mask quality.

## Focused evidence

- Both encoder preparation and text-grounding allocation tests failed by heap
  exhaustion before the direct-buffer fix, then passed with unchanged pixel
  assertions. Seventeen focused render tests passed.
- The original Docker photographic segmentation test passed with rebuilt render
  output mounted into the existing image: all three model-runtime tests, 63.76
  seconds, original V8 heap limit 2,348,810,240 bytes. The full gate rebuilt the
  actual test image separately; this targeted result is not that rebuild.
- Named-axis parsing passed through the real structured adapter and rotated-crop
  consumer. Reinstating the old tuple conversion made the ambiguous-pair
  rejection test fail. All 52 provider/command tests passed after the wire update.
- The integrated built CLI passed all eight help tests plus the ordinary output
  test. Discovery covered all 41 advertised commands, nested forms, missing
  libraries, unreadable credential paths, human quoting and an executable graph
  example. Existing configure/settings/version checks also passed in the help
  implementation worktree.
- Independent code reviews found and corrected human-example escaping and the
  library-wide graph-attempt syntax. A separate parser audit corrected the
  documented blend vocabulary, normalized retouch radius and nested settings
  discovery. Whole-change independent review found no remaining actionable
  correctness or integration issues; it ran 14 focused grounding tests, not the
  full suite.

## Live and visual evidence

Three real gateway calls completed: the ordered-point person request, its
named-axis replacement, and the hair control. The [retained live record](../../../fixtures/segmentation/portrait/photolab/live/README.md)
owns their measurements and verdicts. Both person results fail whole-person
coverage; the hair control remains imperfect. Successful execution and exact
reference parity are not interchangeable claims.

The complete full-frame and feature-crop sets received unprimed visual reviews.
Comparison telemetry confirmed identical developed sources and different masks.
An independent artifact audit verified all 97 retained-file hashes/sizes and 75
image metadata records, plus source/model consistency and case-page links. The
retained directory was also checked for the decrypted credential value: no
matches in any of its 99 files. Headers and encrypted reasoning payloads are not
part of the portable record.

## Full closeout

Run: `bun run verify`, with the existing CMake/Ninja tools on PATH, pinned models
provided through `PHOTOCTL_SEGMENT_MODELS_DIR`, and a loopback-only model server
for the Docker image build. Detailed local log:
`/tmp/openphoto-cli-discovery-verify-20260909.log`.

- Format, lint, typecheck and all TypeScript/Rust/Swift builds passed.
- The initial complete TypeScript stage passed 1,169 of 1,170 tests across 214
  files. The foreground-tag test expired at its implicit five-second total
  watchdog. Its explicit two-second operation assertion remains unchanged;
  with a twenty-second total watchdog, the focused retry passed in 2.61 seconds,
  including worker recovery and persisted tag/embedding checks. The first run
  does not identify which phase consumed its time.
- Rust workspace tests passed: 86 tests.
- The first Docker build stopped before tests at an internal Node 24.20 HTTP
  parser assertion while reading from the temporary Python HTTP/1.0 server.
  The same loopback-only server was restarted with HTTP/1.1; a complete encoder
  transfer then succeeded. No product downloader or model bytes changed.
- The rebuilt Docker retry passed all 214 TypeScript files and 1,170 tests in
  850.18 seconds, followed by all three model-runtime tests in 46.28 seconds.
  The photographic segmentation case passed in 45.29 seconds with its original
  assertions and default process heap.
- The Mac stage passed 20 of 21 tests, including all eleven packaged-install
  cases and the real photographic model test. The warm-daemon latency check
  measured p50 462.89 ms against its unchanged 250 ms threshold while other
  checks were active. A standalone test-file retry during Docker image export
  measured 268.32 ms and also failed. An alternating startup probe substituted
  the pre-follow-up and current CLI entry modules through identical Node loader
  hooks: p50 values were 245.01 and 248.36 ms respectively across twenty measured
  launches each. This probe did not show a large startup difference in the tested
  `--version` path; it does not resolve the failed end-to-end latency requirement.
  After Docker's workload finished, the unchanged standalone latency test passed
  in 6.32 seconds. Its passing output does not report the exact p50, only that it
  met the 250 ms requirement. Neither failed run establishes a specific
  contention cause. The Mac stage and retry together cover all 21 tests.

A read-only performance audit found only bounded argument scans and fixed help
metadata work on the new discovery path, not new image work, network calls or
dependency-graph reachability for warm `show`. The preexisting eager startup
graph remains a possible optimization target; no speculative production change
was made solely in response to the timing misses.

No heap override, quality reduction or test skipping was introduced to make the
model fit. The top-level gate was attempted once; remaining stages and affected tests were
resumed individually rather than presenting the first invocation as green.

Additional local logs are `/tmp/openphoto-cli-discovery-remaining-gate.log`,
`/tmp/openphoto-cli-discovery-docker-retry.log`,
`/tmp/openphoto-cli-discovery-macos-gate.log`,
`/tmp/openphoto-cli-discovery-macos-latency-retry.log` and
`/tmp/openphoto-cli-discovery-macos-latency-final.log`. These are transient
diagnostics; this record owns their durable interpretation. Independent closing
audits checked the rationale, choices, artifact provenance and recorded outcomes.
