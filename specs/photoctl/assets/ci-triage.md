# CI failure triage

The completed [Linux run 34023344394](https://github.com/dzhng/photoctl/actions/runs/34023344394)
tested `dbe550a77eed97775bb41ee403a69819d3684031`: native build and lint passed;
TypeScript tests failed (103 failed, 961 passed; 51 failing files). The later root gates
did not run. The entire failed-test section was inspected, not only its final summary.

## Independent causes

- Fixture manifest refusal contradicted a stale test. The immutable-byte policy remains intact;
  focused tests now exercise refusal without losing annotations and explicit regeneration.
- Provider CLI tests omitted portable volume mapping; all four pass on Linux with the mapping.
  Native policy and memory-rejection tests also contained stale assertions. Markup tests passed
  the deleted frame shape; current-frame tests now catch ignored crop positioning.
- The gold-script fixture assumed checkout-local executable links created during installation.
  Its disposable command directory now invokes the actual built entry points. This tests the
  existing exam, not package installation; the packed-install gate remains separate.
- Offline export loses actionable volume/mount hints. This is reproduced locally and remains
  a public-contract defect, not an assertion to remove. Unsupported-file import also omits
  portable fixture volume mapping; authoritative offline checks must remain before inspection.
- Daemon starts return exit 69 in several CLI tests; one subsequent unchecked PID causes a
  secondary type error. Isolated Linux reimport succeeds, so the CI startup cause is unresolved.
- Many tests exceed runner deadlines, including 5, 15, 30 and 60 seconds. Directory-removal
  errors follow some timeouts. These are not evidence that larger deadlines are correct;
  investigate resource contention and unfinished test work. The upscale spy failure follows
  a timed-out test in the same file; both tests pass unchanged in an isolated local run,
  which does not establish the CI cause.

Focused green results prove their stated scope only. A subsequent full integrated run is
required; camera delivery quality, native RSS and encoder latency gates are not replaced by
test-runner timing. Do not discard historical failures or cancel unrelated CI jobs as a fix.
