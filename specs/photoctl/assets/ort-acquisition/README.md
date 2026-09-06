# Default CPU runtime acquisition evidence

The production Cargo owner builds the pinned source recipe; neither Docker nor
release packaging selects a separate downloaded runtime. These checks distinguish
actual addon initialization from merely importing the lazy JavaScript wrapper.
The earlier [causal experiment](../ort-lazy-proof/README.md) explains the patch;
its explicit library override is not default-acquisition acceptance.

## macOS ARM64

The new source-built addon passed both actual native-load checks (workspace and
an offline scratch installation of the npm-packed platform package), the unchanged
real photographic model test, and all three native SAM session/resampling tests.
The model suite reported 3 passing tests in 28.70 seconds. Controlled real CLI
captures with the old and new addons produced identical sky/path mask identities
and identical structured shape-merge warnings; raw stderr remained valid NDJSON.
The existing full packed-install and linkage gate also passed all 3 tests in
222.52 seconds: external installation, fixture gold export, and the complete
fake-generation/preview journey were retained.

The packaged addon SHA-256 was
`8e605c825971a637931be93db9bf393f22bc3cb557214c58d52787d080789fd8`.
Its linkage audit accepted only system dependencies. The installed addon and all
1,092 Mach-O members of the ORT archive declared minimum macOS 11.0. A deliberate
10.0 policy falsification failed the installed-addon floor assertion; the normal
shared 11.0 policy passed. This is not a claim about Node or Swift support floors.

[Archive provenance](macos-arm64-provenance.json) records the final recipe, observed
compiler/SDK/tool versions, flags, output hash and 1,069.9-second source build.
The final-link correction reused that immutable archive and rebuilt the addon in
10.85 seconds. User-approved isolated tools were CMake 3.31.6 and Ninja 1.13.2
binary wheels; no system tools were installed. Their wheel SHA-256 values were
`da9d4fd9abd571fd016ddb27da0428b10277010b23bb21e3678f8b9e96e1686e`
and `fd82e26c0706ad4ab88e5fdd26f3fab0a987a90f810160f6c322e752c6af298b`.

The unchanged model files were encoder
`113d37e2911d63f84c16daa4944260382741738dec80248bfd7adea8a796311e`
and decoder `be578ee71ad617050c9266b5c36f046302e8333a9e1d351f113848327b0f339d`.
The sky mask remained
`a_cc54532b813dc8ac19ca6f7f978219c45f1d3d724a835fb5d85db76b5cf0ca45`;
the path remained `a_8999e4476ec21a1308f4a122e6dc4578d451e9fb3a2d7d119e296ec0e139b162`.
This bounded comparison does not establish broader photographic quality or
cross-platform numerical identity.

## Linux ARM64 and release limits

The final default Docker build passed both actual native-load/package tests and
the unchanged real photographic model test: 3 tests in 79.73 seconds. All three
native SAM session/resampling tests also passed. The container had no
`ORT_LIB_PATH`; it mounted only the unchanged local model files read-only.
The packaged addon SHA-256 was
`a7baa672c22478424abe9a3a91ec1a81eb3469b78b5957370d7b9cebdf37f4fe`.
Its dynamic dependencies resolved to system libstdc++, libgcc_s, libm, libc and
the loader. [Archive provenance](linux-arm64-provenance.json) records the pinned
identity, GCC 14 toolchain and 1,736.0-second source build.
The separate [strict CLI capture](linux-cli.json) retained both the CPU-vendor
warning and the encoder's shape-merge warning through structured events. Its sky
mask remained `a_81c99b3c4cfa8cfdcc9e9dc8a23d5f3b90247de5321d3d9fbd810c274e44d488`,
matching the prior explicit-override capture. The capture process emitted no stderr.

The first complete source archive exposed a real GNU link-order failure in the
Rust test executable. Moving ORT after the Rust dependency archives resolved its
API, then exposed GCC's outlined ARM atomic helper in `libgcc.a`. Linking that
compiler runtime afterward completed the real test-executable and addon link.
No CPU feature or model contract changed. The final correction reused the exact
completed recipe layer; the successful prior override experiment is not
substituted for default acceptance.

All four native release jobs now require actual packed-addon initialization.
This local evidence does not establish x64 acceptance, an older Linux ABI floor,
or successful release CI runs.

Read-only ELF inspection of this Linux ARM64 debug addon found required symbol versions
`GLIBC_2.38`, `GLIBCXX_3.4.31`, and `CXXABI_1.3.15`. Systems missing those versions cannot load
that binary. These are observed requirements of this artifact, not the requirements of unbuilt
release or x64 artifacts. No release workflow run was available to substitute for those gates.

## Root integration

The root build verified the same compiler/SDK/recipe identity and archive SHA before copying only
the completed archive and provenance into its own target-local cache. Ordinary Cargo then verified
and consumed that entry; no shared writable cache or runtime override was added. The merged
optimized-development addon passed all 3 runtime/model checks in 11.47s and all 71 native tests.
The model test retains its full source and independent subject-area/exclusion assertions.

The merged root's full external installed-CLI/linkage journey passed all 3 tests in 174.82s.
Its resulting release addon is `1d5b6ab19da24f558ee12125d6e449a3546fb65e6c02cf8390cfeded39b5cfa6`.
The subsequent full-resolution canvas G6 rerun **failed** its then-current 3 GB limit:
peak daemon RSS was 4,406,755,328 bytes, with the exact historical mask and one 1.973s encode.
The first request succeeded and the daemon stopped normally; the harness stopped further requests
after the breach. The trace places the growth in preprocessing/compositing; this historical
run alone does not isolate the source-built runtime from profile or buffer lifetime.

The later [merged scene-decode witness](../sam-runtime/merged-scene-resource.json) includes
the owned composite/projection/decoder corrections and passes all three requests under the
user-approved 5 GB budget. It records its own release-addon hash; the earlier packed-install
result above is not silently attributed to that newer binary. Other-platform and photographic
acceptance remain separate.

## Review dispositions

Independent review identified the missing shared macOS deployment floor; the
workspace Cargo policy now supplies Rust, LibRaw and ORT and participates in the
runtime cache identity. A proposed AR/RANLIB/LD environment-override collision was
not reproduced: a real CMake 3.31.6 configure/build with invalid values selected
the actual toolchain binaries successfully. No unsupported override contract was
added. Subsequent source reviews found no actionable issue; runtime acceptance
remains tied to the actual platform gates, not those review verdicts.
After the Linux-only support-link correction, a final warm Mac rebuild and
packaging took 6.68 seconds, passed linkage audit and retained the exact addon
hash above, so the earlier Mac runtime and packed-journey checks still refer to
the final binary.
