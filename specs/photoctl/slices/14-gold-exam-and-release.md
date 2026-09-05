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
`bun run pack` builds optimized native artifacts; development's debug build must not determine the
shipping binary. The release matrix likewise builds optimized binaries before its packed-install gate.

The root release version owns manifest versions, optional package pins, and a generated Swift constant.
Packing checks drift before producing artifacts; the installed CLI and helper are also compared against
that release version. The linkage audit checks loaded libraries, not a dylib's own build-time identity.
Only system libraries are accepted for the current standalone macOS binaries.

`test/macos/packed-install.test.ts` installs real tarballs into a temporary prefix, starts the daemon,
requires both decoder capabilities, and runs the existing gold script against `fixtures:drive` output.
The release workflow consumes these same tarballs, rather than repacking workspace manifests during
publication. The same installed prefix also runs the shared
[`agent-preview` journey](../../../test/journeys/agent-preview.ts): the behavioral oracle is shared with
the built CLI, including exact lossless opacity, local edits, lazy previews, current export identity,
and fake generation/upscale. Public graph pagination must reconstruct the unpaged graph without
truncating identities or losing execution provenance. Fake-adapter configuration is library-local;
no live upscaler credential is needed. This journey uses the established no-daemon test mode so its
canonical-artifact checks can open the library directly; the fixture gold gate independently requires
the installed persistent daemon. Neither gate substitutes for real-drive photographs or
compression-mode fixtures.

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

The existing gold script remains the only exam. Its report writer consumes the command results and
hashes the actual files named by that export, not every image already present in the output folder.
`report.html`, `gold-exam-report.json` and `SHA256SUMS` live beside the delivered JPEGs; their relative
links remain valid when the folder moves. The manifest covers the JPEGs and both reports. Hashes
bind bytes for later integrity checks, not photographic quality. Skipped exports are labeled as
pre-existing files whose match to the requested render has not been verified.

`--source-kind fixture|real|unverified` records the operator's classification; omission means
unverified, and even `real` never records human acceptance. Fixture gates name themselves explicitly.
Use `--out assets/gold-exam/<run>` to retain a real-input bundle; no source path has been supplied
for that remaining checkpoint. The default output-folder behavior is unchanged.

The packed fixture gold and full-feature journey passed together with manifest verification. Focused
tests additionally verify actual-byte hashes, encoded links, unknown-source labeling, exclusion of
unrelated files, and tamper detection. Code review found a carriage-return filename escaping defect;
the regression failed with `shasum -c`, then passed after adopting its supported escaping.
[Report layout evidence](../assets/gold-report/README.md) records desktop/mobile inspection and the
independent visual critique. These screenshots are fixture presentation evidence only.

## External-input recheck — 2026-09-06

Read-only checks on the local Mac found no newly runnable real-input acceptance gate:

- `diskutil list external physical` succeeded with no disks listed. `/Volumes` contained only the
  system-volume alias and Conductor, which `diskutil info` identifies as a read-only disk image.
  No real-drive ARW folder was available to name for the gold script.
- The committed RAW inventory still contains only `a7c2.ARW`; the native LibRaw probe confirmed
  compression tag `1`. The [fixture inventory](../../../fixtures/README.md) distinguishes its
  hand-authored Classic-style XMP from actual Classic exports. Filename searches in Pictures,
  Downloads, Desktop and Documents found no additional ARWs or Classic catalogs/sidecars; the XMP
  hits were unrelated Xilinx project files. The Photos library denied access, so this is not proof
  that no usable originals exist there. No privacy permission was changed.
- IPv4 and IPv6 localhost port 22 refused connections, and `launchctl print system/com.openssh.sshd`
  found no service. The Remote Login settings query required administrator access; its setting value
  was not obtained. `Davids-Mac-mini-7.local` did not resolve here, which does **not** establish the
  connected remote app host's state or whether another SSH-capable Mac exists.

Remaining inputs are an accessible external-drive folder with at least ten distinct A7C II originals,
actual Classic sidecars, the missing compression-mode frames, and a usable SSH Mac session for
[G3](../assets/gates/G3-ciraw-headless.md). The current shell also has no `photoctl` on PATH; the
documented clean-prefix install supplies it when a real source folder is available. No source files or
services were changed, no credentials were inspected, and no whole gate or paid request was run.
