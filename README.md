# OpenPhoto

A CLI-first photo library and non-destructive editor for photographers and agents.
The complete workflow must be usable without a screen. Human and machine interfaces
share the same capabilities; a GUI must not become a separate product with exclusive features.

## Installation and credentials

The npm package is `@dzhng/openphoto`; it installs the `openphoto` command and
its platform-specific native dependencies. Run `openphoto configure` to enter an
AI Gateway key without terminal echo. `openphoto configure --help` describes
non-interactive input. Configuration makes no network request.

Credentials are plaintext in `~/.openphoto/.env`, readable and writable only by
the owner. They are separate from photo catalogs and backups. Each command loads
the saved key; an explicit `AI_GATEWAY_API_KEY` environment value takes precedence,
including an empty value. A running daemon adopts changed credentials on its next
foreground request, without cancelling work already in progress.

Existing catalog locations and `PHOTOCTL_*` environment controls stay stable.
The repository and private package names remain photoctl.

## Principles

- **Preserve originals.** The library owns editing state;
  writing metadata back beside source photos is always explicit.
- **Make limitations visible.** Continue when usable work is possible, and report degraded
  or unavailable inputs honestly rather than silently changing the result.
- **Generate only what must be invented.** Deterministic restoration and geometry stay
  local; they do not need a generative service.
- **Guarantee fidelity.** Pixels outside a masked edit are preserved by the application,
  not by trusting a model to leave them alone.

## Verification policy

The acceptance target is David's Apple Silicon Mac and camera workflow. Intel Mac and
Linux verification are not spec-completion or release-preparation requirements.
Keep the portable implementation and existing tests, but do not add platform-validation
work without a concrete need. Unverified platforms are not claimed as verified.

GitHub CI provides fast feedback through lint, typechecking and a small smoke-test subset.
The full suite belongs in local development and deliberate release verification, not on
every push. A green GitHub check is not release acceptance; keep full local coverage intact.

Use focused tests while iterating and the full local gate at implementation closeout,
not as a feedback loop. Do not optimize product code or weaken product requirements
merely to fit a hosted runner. [Contributor guidance](AGENTS.md) explains how to choose
and run the appropriate checks; [project commands](package.json) and the
[CI workflow](.github/workflows/ci.yml) define the executable gates.

## Development

Bun installs and orchestrates; Node 24 runs everything, including tests. A native
build additionally needs a Rust toolchain plus CMake and Ninja for the pinned ONNX
Runtime recipe, and the Swift toolchain on macOS for the Core Image helper.
`bun install` then `bun run build` produces the CLI, the image addon and the helper;
`bun run verify` is the complete closeout gate (format, lint, typecheck, build and
every test stage). Lint also checks that every relative link in the live docs
resolves; closed specs under `specs/done/` are frozen records and are exempt. The
scripts in [package.json](package.json) name each stage individually;
[contributor guidance](AGENTS.md) explains which rung of the test ladder to run
while iterating.

## Where things live

- [Installation and live-provider plan](specs/openphoto/README.md) — current verification work and credential boundaries.
- [Segmentation quality research](specs/segmentation-quality/README.md) — the PhotoLab target, measured candidates and remaining quality gaps.
- [v1 record](specs/done/photoctl/README.md) — why the product has this shape, the invariants it keeps, and the decisions made along the way.
- [Reference fixtures](fixtures/README.md) — retained inputs and the facts they establish.
- [Native build guide](crates/photoctl-image/ort/README.md) — runtime acquisition and platform constraints.
- [LibRaw boundary](crates/libraw-sys/README.md) — where the vendored decoder stops and why.
- [Color profiles](packages/render/assets/README.md) — the bundled ICC profiles and how the linear one is regenerated.

## Releases

Version tags drive package and model publication together. A CLI release downloads
its verified ZIM ONNX files from an immutable upstream revision, never a moving
“latest” model. The bundled [ZIM notice](packages/library/assets/ZIM-NOTICE) and
[noncommercial license](packages/library/assets/ZIM-LICENSE) govern those artifacts.
Libraries can explicitly
select a mirror through `openphoto settings set models_base_url`, validated by
[the settings registry](packages/protocol/src/verbs/settings.ts). The
[release workflow](.github/workflows/publish.yml) owns the publication boundary; the
full local suite remains a release-preparation responsibility, separate from the
hosted release checks.
