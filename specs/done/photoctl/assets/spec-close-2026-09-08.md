# Spec-close gate — 2026-09-08

One uninterrupted run of the full local gate on the tree that closes the v1
spec: production source `a1a51fb` (the review-consolidation commit), with the
documentation-only archive changes applied afterwards. This is the single
closeout run the root policy asks for; it was not used as a feedback loop.

| Stage | Result |
| --- | --- |
| `fmt:check`, `lint`, `typecheck` | pass (lint reports pre-existing warnings only) |
| `build` (TypeScript, Rust addon, Swift helper) | pass |
| Host `test:ts` (single worker) | 207 files, 1118 tests, 994 s |
| `test:rust` | 9 + 76 tests |
| Docker functional (`test:ts` then `test:models`, single worker) | 207 files, 1118 tests, 1303 s; real-model probes 2 files, 3 tests, 23 s |
| macOS (`build:swift`, packed install, decoder oracle, real SAM, native linkage, daemon performance) | 7 files, 18 tests, 263 s |

Exit 0, `GATE PASSED`. The invocation and complete log are retained at
`/private/tmp/photoctl-closeout-vienna.ooHyDX/{gate.sh,gate.log}`; the script
serves the existing verified model directory to Docker over a loopback-only
HTTP server, exactly as the previous closeout did, and uses the user-approved
isolated CMake/Ninja tools on `PATH`.

## Scope notes

- The three evidence-writing scripts (`scripts/{probe-toast,smoke-embed-shape,smoke-mask-polarity}.mjs`)
  had their default output path repointed to `specs/done/photoctl/` after the
  gate started; the change is a string default and is not covered by this run.
- The keepalive fix and every review consolidation were committed before the
  run, so this is the first full gate on the daemon keepalive contract (S96).
- No camera, provider key or public publication was involved; live provider
  quality, mask polarity and actual release publication remain unverified, as
  the closed README records.
