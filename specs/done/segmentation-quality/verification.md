# Verification record — 2026-09-09

This closes the practical research-and-implementation scope, not a claim of
PhotoLab parity or universal platform compatibility. The accepted platform is
the owner's Apple Silicon Mac; Linux validation is not a release-acceptance
requirement under the root verification policy.

## Engineering checks

- Formatting, lint and typechecking pass. Lint retains existing warnings.
- TypeScript, native Rust and Swift builds pass. The local shell required the
  available CMake/Ninja tools on PATH; this was an invocation prerequisite,
  not a product-code change.
- The first complete TypeScript run passed 151 files and failed 61 under the
  automatic seventeen-worker schedule. All 61 failed files then passed their
  unchanged deadlines with the committed two-file worker budget: 472 tests.
  Together these runs cover all 212 files and 1,159 tests. They are not described
  as a single clean full-suite run.
- Rust workspace tests pass: 86 tests.
- Docker subsequently passes all 212 TypeScript files and 1,159 tests in one run.
  Its native-package loading checks also pass.
- The real photographic ZIM test passes on the Mac, including the original
  independently authored sky/road area bands and confident interior/exterior
  samples. This is a coarse functional check, not fine-edge acceptance.
- Mac checks pass across the initial platform run and two-file prerequisite
  retry: all 21 tests, including 11 packaged-install cases and the real-model
  photographic test. The retry passes 12 tests in 181.75 seconds.

The top-level closeout was attempted once, then resumed by remaining stage and
failed-file checks instead of repeatedly rebuilding and rerunning the whole gate.
An initial formatting failure in release scripts was corrected using the existing
formatter. One manual Mac-stage invocation omitted both the model path and build
tool PATH; its two affected files were rerun with those prerequisites restored.

## Explicit failed and unavailable checks

The Docker real-model test fails. A direct CLI diagnostic reproduces an empty
stdout and `SIGABRT`; stderr reports V8 JavaScript heap exhaustion around 2 GB.
The container's cgroup OOM counters remain zero. Thus the original JSON parse
error hid a process heap failure, not a failed segmentation assertion. No global
heap setting, Docker allocation or product quality limit was changed to hide it.
The complete `bun run verify` result is therefore **not green**.

An actual automatic whole-person ZIM capture could not run because neither the
environment nor saved configuration supplied a gateway key. Signed grounding
and instance-selection consumer tests pass, but are not substitutes for that live
capture. No credential, model publication or image redistribution was inferred.

The production photographic visual review fails fine-wire, foliage-gap and
foreground-fence exclusion. Portrait appearance is comparable only at the
supplied reference viewport; missing strands and leakage remain. The user's
revised stopping condition permits retaining these as future cases instead of
continuing an indefinite model search.

## Durable evidence

The [reference collection](../../../fixtures/segmentation/README.md) retains
exact source pixels, observations, targets and their provenance. Its independent
audit verified hashes and dimensions for all 44 retained assets and checked the
scene/target classifications; repository live-document link validation passes.
The collection contains two evaluated photographed scenes plus an explicitly
unevaluated varied camera-image pool, not invented ideal masks.

The [native contract evidence](assets/zim-contract/reference.json),
[pixel-port comparison](assets/zim-contract/pixel-port.json),
[runtime measurements](assets/zim-contract/runtime-budget.json) and
[CLI visual verdict](assets/cli-holdout/critique.md) preserve the bounded claims.
Whole-cutover independent code review reported no actionable regressions;
some reviewer test execution was sandbox-blocked, so the local results above
remain the execution evidence. A separate unprimed audit checked the closing
README against code and retained provenance.

Local detailed logs are `/tmp/openphoto-zim-verify-20260909.log`,
`/tmp/openphoto-zim-failed-recheck.log` and
`/tmp/openphoto-zim-remaining-gate.log`. These are transient diagnostic logs,
not committed portable artifacts; this record owns their final interpretation.
