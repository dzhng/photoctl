# Full-source default-build performance

## Audit before changing defaults

**P1 — Unoptimized native image work breaches the existing public gate.** A first native
view/export of the committed 7008×4672 RAW processes 32,741,376 pixels and 98,224,128 RGB
samples. The normal test build uses Cargo's unoptimized dev profile for both the Rust image
crate and the vendored LibRaw C++ build; `cc` inherits Cargo's `OPT_LEVEL`. The standalone
native stages measured 9.085s decode, 7.497s camera-front conversion, and 9.875s display-back
conversion before artifact/CLI overhead. The owning seam is the workspace's native build
profile, not a special case in `show` or a reduced source request.

The exact public sequence measured by root takes init 1.635s, import 0.497s, pinned offline
detail 2.173s, first online detail 39.196s, and cached offline detail 0.585s. The online
execution retains full 7008×4672 native whole-file sampling and a 1000×1000 detail with unit
coordinate matrices. Three existing 30-second CLI tests time out in both the candidate and
clean `ff06b7a` control with matching dev builds. The acceptance seam remains those unchanged
timeouts and full-resolution assertions, not a wall-clock unit test of a configuration value.

**P2 — Two source-tier assertions describe the superseded preview path.** The full-source
detail journey still expects `online-jpeg-range` after reconnect and on retained cache reuse.
Both clean control and candidate select LibRaw 0.22.2-Release, supported=true, compression=1,
fellBack=false. The public result is `online-file`; dimensions, projection, recovery warnings,
and full-resolution output remain required. The correction belongs to those test expectations,
not to forcing a fallback decoder so an old expectation passes.

**Dismissal — Repeated cold decoding is not an unbounded retry loop.** Work follows a finite
source ladder and is bounded by the image. Root's retained-cache request completes in 0.585s;
there is useful cache progress. Keep the cache's richer-source recovery signal. This pass does
not introduce cache shortcuts, a new source tier, smaller fixture, broader performance rewrite,
or timeout increase.

## Matched profile experiment

Same clean `ff06b7a` source, full RAW, Node 24.14.0, rustc 1.94.1 and Apple clang 21.0.0;
no CXXFLAGS override. Each stage runs once in a fresh Node process per profile; these are
diagnostic timings, not a universal performance threshold. Only the packaged build profile changes.

| Native stage | Default dev | Existing release | Targeted optimized dev |
| --- | --- | --- | --- |
| Decode and camera-buffer production | 9.085s | 1.505s | 1.914s |
| Camera-front conversion | 7.497s | 0.213s | 0.205s |
| Display-back conversion | 9.875s | 0.763s | 0.763s |

All three complete 98,224,128-sample Float32 buffers have identical SHA-256s across profiles:

- Decode: `b2dbec0ab8cc971fb481967e1e1412ceff5f7414b4b5ad28c2c9c4b4bbca75be`
- Camera-front: `c65b76a77523358b919f8492227f7f70b7fca81b0bc6089035977701d9ded35b`
- Display-back: `1bcf0cdc7e2876f4c97d03332dcc2dc435062b8dd91983f46ef88d75fae143ba`

**Proposed policy, reported before changing defaults:** optimize only `photoctl-image` and
`libraw-sys` in the dev profile. Cargo's test profile inherits dev; debug information, overflow
checks, debug assertions and ordinary debug packaging stay enabled. Unrelated crates and build
dependencies keep their existing settings. This is smaller than switching the default workflow
to release, and does not hard-code C++ optimization separately from the profile owner.
[Cargo's profile reference](https://doc.rust-lang.org/cargo/reference/profiles.html#overrides)
documents package overrides and test inheritance.

## Targeted-profile verification

Verbose build and test compilation both show `opt-level=3`, `debuginfo=2`, and
`debug-assertions=on` for the two packages; no overflow-check override is introduced.
LibRaw's build script receives `PROFILE=debug`, `DEBUG=true`, `OPT_LEVEL=3`.
The global Cargo summary still says unoptimized because unrelated packages keep dev defaults;
the per-package compiler commands establish the actual profile. Debug packaging is unchanged.

All 13 first-JPEG public CLI tests pass with their original deadlines and full-resolution input.
The previously failing detail-promotion, full-source export, and bad-id/valid-export journeys
take 9.607s, 6.806s, and 8.234s respectively against their unchanged 30-second budgets.
The release-powered unchanged detail test first exposed only the stale tier expectation,
then correcting that expectation and using targeted dev produced green public behavior.
The native workspace tests pass (68 tests); their optimized test binaries retain debug assertions.
The neighboring built-CLI LibRaw lossless-L fixture test also passes (4.225s), exercising
compressed RAW admission, decoding, TIFF output, and reported decoder availability.
These measurements certify this machine and input, not a universal latency guarantee or a
memory improvement. Optimization can make source-level stepping and local-variable inspection
less direct even with debug information retained.

Root integration rebuilt and packaged the native addon on the merged crop/SAM tree. All 13
first-JPEG checks passed in 43.19s total; the previously failing detail, full-source export and
mixed-ID export cases took 8.401s, 7.283s and 6.604s at their unchanged 30-second limits.
