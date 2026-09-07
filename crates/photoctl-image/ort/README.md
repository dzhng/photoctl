# CPU runtime acquisition

Native builds use one source recipe, reached through Cargo whether the caller is
a developer, Docker, or release CI. `ort-sys` cannot select a downloaded runtime
behind that owner's back. The ordinary ORT API remains statically linked.

The recipe preserves CPU feature discovery and kernel selection while delaying
CPU-reading initializers until an explicit logger exists. This is necessary for
the CLI's strict JSON stderr contract: diagnostics belong to the native worker's
typed diagnostic transport, not process-load side effects. The causal experiment
is retained in the spec; it is not evidence that this build is byte-equivalent to
the vendor's served archive.

[`recipe.json`](recipe.json) pins source and patch content. The bundler derives
from the identified Apache-licensed builder, with constituent-file dependencies
added so incremental rebuilds cannot retain a stale combined archive. Upstream
dependency URLs and hashes are owned by the pinned ONNX Runtime source.

Build prerequisites are Python 3.11+, Git, CMake 3.26+, Ninja, and the native C++
toolchain selected by [`prepare.py`](prepare.py). Linux uses GCC 14; macOS uses
the active Apple SDK and Clang. The build never installs tools. Cross-compilation
is deliberately not inferred from a target triple: release jobs build on native
hosts. The existing x64 feature floor is retained, not broadened.

The workspace Cargo configuration owns the image addon's macOS deployment floor,
shared by Rust, LibRaw and ORT. An explicit `MACOSX_DEPLOYMENT_TARGET` may override
it. A standalone Apple preparer invocation must supply that value too; it never
infers the floor from the builder's current OS. This is the image addon's floor,
not a claim about the CLI's Node or Swift-helper requirements.

The cache belongs to the Cargo target directory. Recipe and observed toolchain
identity select an entry; its provenance records the output hash and build time.
This is a reproducible source recipe, not a claim of hermetic or bit-identical
outputs across SDKs and compiler revisions. Cargo serializes its use. Docker's
recipe-only layer invokes the same preparer before Cargo, never concurrently.
Do not invoke the preparer alongside a Cargo build using that cache.

An interrupted compile resumes incrementally. A partial source-patch application
or damaged completed archive is reported with its exact cache entry rather than
silently switching runtime implementations. Only that disposable entry needs
removal to retry; no project source or shared cache is reset.

The [root verification policy](../../../README.md#verification-policy) names the
required acceptance target. A claim of platform acceptance needs real native load,
model/CLI and packaged-linkage evidence; a successful build alone supplies none of
those claims for Intel/Linux or an older Linux ABI floor.
