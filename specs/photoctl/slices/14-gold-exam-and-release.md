# 14 — real-drive gold exam + packed-install release gate

## API seam
`bun run pack` → tarballs for `apps/cli`, `packages/img-darwin-arm64`, `packages/mac-helper-darwin-arm64` (ships
`photoctl-mac`; `-darwin-x64` as a sub-slice); `scripts/install-clean.sh` (`npm install -g ./*.tgz --prefix <clean>`);
`otool -L` audit; `photoctl doctor` from the packed install must report `ciraw` and `libraw`. `scripts/gold-exam.sh
/Volumes/<drive>/<folder>` → `assets/gold-exam/<date>/report.html` + sha256s. Real Classic sidecars → `fixtures/xmp/`; one frame
per ARW compression mode → `fixtures/` with manifest rows; `decoder-libraw.test.ts` is parametrized over manifest rows (absence is
not a skip). The root release version is the one owner for the CLI, package manifests, and the Swift helper's `--version` output;
the version-sync test fails if any packaged surface drifts.

## Verification
The gold exam (human accepts JPEGs as deliverable); `packed-install.test.ts` (macos): packed CLI runs the fixture gold exam; linkage
audit. The full-feature run also executes the keyless fake-adapter reimagine and masked-density cases from 12/13, verifies full
render/node/artifact hashes and paginated graph inspection from the packed CLI, and proves missing live upscaler credentials do not
block release. A configured live adapter remains smoke evidence, never a release prerequisite.

### Lightroom interoperability policy

**User direction, 2026-09-07:** actual Lightroom Classic interoperability testing and
verification are optional, not spec-completion or release blockers. Keep the XMP
implementation and existing regression coverage. A genuine Classic-produced sidecar
may strengthen interoperability evidence later, but its absence must not hold up
the spec. Do not relabel authored Classic-style fixtures as verified Classic output.

## Checkpoint (real input): three real JPEGs — professional "not broken"; `people` retune is data-only. Use
`compare-screenshots` against their accepted pre-generation render when applicable and run an unprimed `screenshot-critique` last;
review is non-blocking per the root rule.
## Must stay green: everything. Deps: 08 (min), 13 (full). Firewall: taste edits touch preset/prompt data only.

## Packed runtime ownership

The CLI tarball embeds the private workspace dependency closure, including the daemon. Module-relative
profiles and preset data retain their package layout; runtime discovery uses Node package resolution,
so an installed command has no checkout-relative executable paths. The CLI manifest alone owns the
installed external dependencies: npm also treats dependencies of a bundled package as bundled, so
retaining those edges on embedded manifests would mark absent external files as already shipped.
Platform image addons and Swift helpers remain separate optional packages.

## Model distribution

The tag-triggered [release workflow](../../../.github/workflows/publish.yml) owns
CLI packages and their matching SAM model assets. The tag must equal the root
package version. Export uses pinned upstream revisions and CPU parity checks;
generated candidates must match the committed model hashes, never silently replace
them during publication. Model changes are reviewed and pinned before tagging.

Native jobs consume the prepared model artifact directly. This avoids requiring a
public model URL for a release that does not exist yet. Hosted release verification
checks actual native/model loading, macOS packaging, lint, types and smoke behavior;
the complete suite remains a local release-preparation gate under the root policy.

All packages, model files, provenance, hashes and the SAM license are attached to
one draft release before it is published. Public model downloads are hash-verified
before npm publication, so a newly installable CLI does not point at missing assets.
GitHub and npm publication are not an atomic transaction: an npm failure can leave
a complete GitHub release available without every npm package published.

`doctor --fetch-models` uses the installed CLI version's GitHub release by default.
The existing `models_base_url` setting remains an explicit mirror override; null
means use the release default, not an unconfigured installation. Files are still
verified against the packaged manifest and reused from the local model directory.
There is no database migration, automatic download at install/import, moving-latest
lookup, new hosting service or Git LFS dependency. Unpublished development versions
need a mirror to fetch models until their release exists.

Workflow wiring and local checks do not prove a public release has run successfully.
Do not push a publication tag merely to test the workflow.

## Packed package boundary
`bun run pack` builds optimized native artifacts; development's debug build must not determine the
shipping binary. The release matrix likewise builds optimized binaries before its packed-install gate.

The root release version owns manifest versions, optional package pins, and a generated Swift constant.
Packing checks drift before producing artifacts; the installed CLI and helper are also compared against
that release version. The linkage audit checks loaded libraries, not a dylib's own build-time identity.
Only system libraries are accepted for the current standalone macOS binaries.

`test/macos/packed-install.test.ts` installs real tarballs into a temporary prefix, starts the daemon,
requires both decoder capabilities, and runs the existing gold script against `fixtures:drive` output.
The release workflow transfers native binaries and assembles its publication tarballs in the
release job. Local packed tests therefore prove the packaging path, not byte-for-byte identity
with published archives. The same installed prefix also runs the shared
[`agent-preview` journey](../../../test/journeys/agent-preview.ts): the behavioral oracle is shared with
the built CLI, including exact lossless opacity, local edits, lazy previews, current export identity,
and fake generation/upscale. Public graph pagination must reconstruct the unpaged graph without
truncating identities or losing execution provenance. Fake-adapter configuration is library-local;
no live upscaler credential is needed. This journey uses the established no-daemon test mode so its
canonical-artifact checks can open the library directly; the fixture gold gate independently requires
the installed persistent daemon. Neither gate substitutes for real-drive photographs or
compression-mode fixtures.

The [shared paired-originals journey](../../../test/journeys/paired-originals.ts) also runs
through the installed persistent daemon, outside the checkout. The fixture gold input is
RAW-only, so this separate journey owns paired RAW/JPEG source selection and companion
offline behavior. [Pairing evidence](../assets/paired-import-review.md#built-and-installed-fixture-journey)
distinguishes the completed prebuilt-runtime checks from the full fresh-package gate.

**2026-09-05 checkpoint:** the macOS ARM64 packed-install gate passed in 133 seconds, including the
normal daemon path and all ten fixture ARW exports. Release-mode native kernel tests, version drift
and repair tests, and positive/negative linkage probes passed. The first debug-build delivery had taken
about four minutes, which exposed the missing release-profile selection without changing pixel code or
the gold exam's scope. Independent Codex review found no actionable correctness findings. No tag,
npm publication, real-drive acceptance, or other-platform CI result is claimed by this local checkpoint.

**Full-feature checkpoint:** both packed journeys passed together on macOS ARM64. The shared journey
also passed against the development build; deliberately dropping the public continuation cursor and
substituting a different full execution identity each failed the corresponding assertion before being
restored. Independent review's provenance-binding and setup-budget findings were addressed. The HTML
report and SHA manifest are implemented below, without claiming photographic acceptance.

## Portable gold evidence

**Current package checkpoint — 2026-09-07:** after the preview color correction
at `a620217`, the complete macOS ARM64 packed-install file passes all nine cases
with no skips in 211.68 seconds. The [runner report](../assets/packed-install-preview-2026-09-07.json)
records fresh optimized native packaging and clean-prefix installation, fixture gold,
paired originals and the shared editing lifecycles. Only a choices-ledger status
correction changed during the run; product and test code stayed fixed.
The image addon still matches the native checkpoint's SHA-256 below.
The [first setup attempt](../assets/packed-install-missing-tools-2026-09-07.json)
failed before any test ran because CMake was absent from PATH. Reusing the already
approved isolated tools at `/private/tmp/photoctl-build-tools.cZGYSv/bin` resolved
the prerequisite without changing system tools or tests. This is current installed
fixture evidence, not full-repository, mounted-drive or photographic acceptance.

**Native checkpoint — 2026-09-06:** all nine macOS ARM64 packed-install cases
pass with no skips in 182.91 seconds on source `e074e0a`. The
[saved runner report](../assets/packed-install-balanced-2026-09-06.json) covers the
complete file, including fixture gold, paired link/copy, preview, warm/cold outpaint and
full-frame lifecycles. The rebuilt image addon SHA-256 is
`c6cdb5aac1d845e63b0426bda5cf18794ed1aa73a2f9f077963ecd67c17fe5d5`.
The separate native-load gate passes both quiet-loading and isolated-package/deployment-floor
checks. This is historical local fixture evidence, not a mounted-drive, live-provider,
other-platform or full-repository closeout result.

The existing gold script remains the only exam. Its report writer consumes the command results and
hashes the actual files named by that export, not every image already present in the output folder.
`report.html`, `gold-exam-report.json` and `SHA256SUMS` live beside the delivered JPEGs; their relative
links remain valid when the folder moves. The manifest covers the JPEGs and both reports. Hashes
bind bytes for later integrity checks, not photographic quality. Skipped exports are labeled as
pre-existing files whose match to the requested render has not been verified.

`--source-kind fixture|real|unverified` records the operator's classification; omission means
unverified, and even `real` never records human acceptance. Fixture gates name themselves explicitly.
Use `--out assets/gold-exam/<run>` to retain an evidence bundle. The
[mounted-camera run](../assets/mounted-gold-2026-09-07/README.md) proves the prescribed
mechanical exam through a fresh packed install; photographic acceptance remains open.
The default output-folder behavior is unchanged.

The packed fixture gold and full-feature journey passed together with manifest verification. Focused
tests additionally verify actual-byte hashes, encoded links, unknown-source labeling, exclusion of
unrelated files, and tamper detection. Code review found a carriage-return filename escaping defect;
the regression failed with `shasum -c`, then passed after adopting its supported escaping.
[Report layout evidence](../assets/gold-report/README.md) records desktop/mobile inspection and the
independent visual critique. These screenshots are fixture presentation evidence only.

## External evidence boundary

[Camera-reference delivery review](../assets/camera-delivery-review/README.md)
preserves the historical gold-script run whose photographic output **failed** inspection.
Reduced-RAW striping and conspicuous highlight-color corrections now have integrated
evidence; remaining fine-edge fidelity and the explicit complete-delivery verdict are
owned by [RAW delivery acceptance](07-highlight-reconstruction.md#c--complete-raw-led-delivery-acceptance).
Successful command exits do not close that photographic gate, and historical corrected
defects must not keep triggering the same diagnosis.

The [camera reference collection](../../../fixtures/camera/README.md) retains real original pairs
covering every observed format/crop/orientation group on the supplied card. The camera need not
remain connected for development. [Paired-import evidence](../assets/paired-import-review.md)
owns the earlier partial mounted-card journey; the mounted gold evidence above now
records the prescribed exam separately.
Do not list camera samples or compression coverage as missing, or assume the camera remains mounted.

SSH/headless acceptance is removed by explicit user direction. Ordinary macOS decoder
tests and portable LibRaw verification remain required. Actual Classic sidecars are
optional under the Lightroom interoperability policy above; authored fixtures do not
prove an actual Classic export.
