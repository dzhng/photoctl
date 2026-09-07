# Preview-corrected local verification

Source: `ea0971c216b4b3298372740b272d9e212427c104`. No production code, tests,
timeouts or configuration changed during these checks. This is **not a clean
integrated pass**: preserve the failed attempts separately from targeted follow-ups.

| Stage | Observed result |
| --- | --- |
| Host TypeScript | 200 files passed; 1,096 tests passed, one five-second timeout; 1232.16 s |
| Rust | 9 LibRaw and 78 image tests passed |
| Docker TypeScript | All 201 files / 1,097 tests passed; 1123.11 s |
| Docker real models | All three tests passed; 23.75 s |
| macOS | 16 tests passed; one missing-model-directory prerequisite failure; 201.03 s |
| Corrected macOS model invocation | The unchanged failed test passed; 11.82 s runner duration |

The [initial log](preview-closeout-host-2026-09-07.log) ends with the failed
host summary. The [remaining-stage log](preview-closeout-remaining-2026-09-07.log)
records the subsequent Rust, Docker and macOS stages without repeating the host
suite. Terminal tool results report exit 1 for both invocations; the logs do not
encode process exit codes. Both used one Vitest worker, unchanged
coverage and unchanged timeouts. The macOS file includes nine successful fresh
release-package tests, not a reuse of an earlier installed build.

## Host timing uncertainty

`packages/commands/src/reimagine-layer.test.ts` timed out at the default 5,000 ms.
An immediate unchanged focused run passed in 1,495 ms (terminal tool output,
not a retained standalone log). The same test passed within the complete Docker
suite in 1,433 ms. These results establish successful behavior in those runs,
not the cause of the host timeout or a clean host-suite result.

Next investigate this test narrowly before changing its budget or assertions.
Do not attribute it to machine load without evidence, rerun the entire gate as a
feedback loop, or optimize production code around an unexplained timing sample.

## Corrected macOS prerequisite

The macOS configuration includes the real-model tests. Its invocation omitted
`PHOTOCTL_SAM_MODELS_DIR`; the test failed before importing or running inference.
Only that test was rerun with the existing hash-verified normalized ONNX directory:
`/private/tmp/photoctl-sam-export-env.77ruAk/candidate-normalized`.
The [corrected log](preview-closeout-macos-model-2026-09-07.log) records the passing
test summary; terminal tool output confirms exit 0.
No test or product change was required.

Docker fetched the same encoder and decoder hashes pinned in `fixtures/models.json`.
The temporary download server and task-created gateway fixture service were stopped.
These checks do not establish public model hosting, detailed photographic mask
quality, mounted-camera acceptance, Classic interoperability, SSH operation or
additional native platforms.
