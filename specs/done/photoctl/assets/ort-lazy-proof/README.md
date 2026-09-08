# ORT initialization causal proof

This is a scratch Linux ARM64 source-build comparison, not release acceptance or binary
equivalence to the served Pyke archive. The production mandatory Linux model gate remains red.
The [exact patch](lazy-cpu.patch), [probe](probe.cpp), and [captured results](results.json)
preserve the falsifiable boundary: initialization timing changes; CPU selection does not.

## Identity and reproduction

Both baseline and candidate use ONNX Runtime source
`da9b5e364c465de65c49d91e696cd6485270757f` (1.28.0) and
`pykeio/ort-artifacts` builder `29e64feda5106a3f9b1a5cab715f718219e080a9`, including
all six patches in that builder's `src/patches/all` directory. The original served ARM64 archive has
SHA256 `06a050ab9137ccb32421d0cb49e9ccf72d9e18ab0aeb8f8d038d1b5cc844b35a`;
its exact builder revision is unproven. Neither source build is claimed to reproduce it.

The scratch container uses Debian Trixie, GCC/G++ 14.2.0, CMake 3.31.6 and Ninja 1.12.1,
native ARM64 compilation, two compile jobs and an 8 GiB memory cap. Source, builder,
build and probe are mounted under `/proof`. Apply [the probe target patch](probe-target.patch)
to the pinned builder before configuration. Baseline has only the six vendor patches;
[candidate 1](candidate1.patch) adds the incomplete three-fact deferral; candidate 2 instead
adds [the complete patch](lazy-cpu.patch) to that same baseline (do not apply both candidate
patches cumulatively). Configure the builder's `src/static-build` with:

```sh
cmake -S /proof/builder/src/static-build -B /proof/build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_CONFIGURATION_TYPES=Release \
  -DCMAKE_INSTALL_PREFIX=/proof/artifact \
  -DONNXRUNTIME_SOURCE_DIR=/proof/onnxruntime \
  -DCMAKE_C_COMPILER=gcc-14 -DCMAKE_CXX_COMPILER=g++-14 \
  -Donnxruntime_BUILD_UNIT_TESTS=OFF -Donnxruntime_USE_KLEIDIAI=ON \
  -Donnxruntime_CLIENT_PACKAGE_BUILD=ON --compile-no-warning-as-error
cmake --build /proof/build --target photoctl_probe --parallel 2
```

The scratch CMake target links `onnxruntime_static_lib`, `nlohmann_json::nlohmann_json`,
`${CMAKE_DL_LIBS}` and `Threads::Threads`, with C++20 and include directories for the
source's `onnxruntime`, `include/onnxruntime`, `include/onnxruntime/core/session`, and
the build's `_deps/abseil_cpp-src` and `_deps/gsl-src/include`. Its executable source is
`/proof/probe.cpp`. `CPUINFO_SUPPORTED` matches the configured runtime's private class layout.

The builder's combined-archive custom command did not invalidate when constituent libraries
changed. Preserve and move the existing `libonnxruntime_static_lib.a` out of the build path
before the candidate's final build; verify that Ninja reports both bundling and probe relinking.
The recorded candidate was explicitly rebundled, not a stale executable. No vendor reset,
cleanup, upload or publication script was run.

## Result and limits

Baseline prints the CPU-vendor warning before `main`, outside its explicit logger. Deferring
only KleidiAI's three CPU facts is insufficient: candidate 1 reproduces the same failure.
Compiled initializer inspection identified three additional NEON dispatch objects and four
CPU-reading cached kernel selections. Candidate 2 defers those too, preserving original
copy/reference semantics and leaving the fixed, non-CPU-reading SBGEMM selector unchanged.

Candidate 2 has empty stderr and delivers the warning once through the explicit environment
logger. Both CPU feature snapshots agree; both identity outputs are `[1,2,3,4]`; both reject
the invalid model. This demonstrates actual compiled ordering on this Linux ARM64 host, not
merely absence of suspicious source text. The probe does not prove failed-worker diagnostic
delivery, session-request attribution, full operator/model parity, or actual CLI NDJSON.

SHA256 witnesses:

| Artifact | Baseline | Candidate 2 |
| --- | --- | --- |
| Probe | `40f1e1c8f21630bc3700e092a8dc7a4afa5aba748bc808857e81a41cfb657a1f` | `3f477a8e9da905d4fd50508dbfaaafaf013033a23d0191014d61a6fb6055f686` |
| Combined static archive | `5fbdd2f7ea2c32351c01b2d07dbefea107879ab2b1c790f8e8229b452eb6adea` | `bc9ccd0763a221627de7db6f8e0cac5fb0903189a085d2d75c2fa3aec3fa641a` |

## Actual addon and CLI integration

An isolated container from the functional image selects the candidate archive through the
existing `ort-sys` override: copy the combined archive to `/ort-candidate/libonnxruntime.a`, set
`ORT_LIB_PATH=/ort-candidate`, and rebuild `photoctl-image`, package it with the existing native
packaging script, then rebuild TypeScript. No repository runtime-default selection changes.

The unchanged `bun run test:models` passes both photographic subjects under the strict NDJSON
harness. The [single-command capture](cli-warning-proof.mjs) uses that same harness and fixture,
requiring the CPU-vendor warning to survive as a structured event on this known-warning host.
Its [result](cli-result.json) also retains the encoder shape-merge warning and resulting mask
identity. This host-specific evidence script is not a portable requirement that all CPUs warn.

The native logger bridge uses typed creation/job outcomes and the existing command event
transport, including failure paths. Runtime distribution across host, Docker and release builds
remains unresolved; no default selection, public hosting, model bytes, CPU flags, database
schema or provider behavior changed here. The default Linux gate remains unresolved until
artifact acquisition selects the corrected runtime reproducibly; the override proves integration.
