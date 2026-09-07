# photoctl

A CLI-first photo library and non-destructive editor for photographers and agents.
The complete workflow must be usable without a screen. Human and machine interfaces
share the same capabilities; a GUI must not become a separate product with exclusive features.

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

## Where things live

- [Development plan](specs/photoctl/README.md) — current status, requirements and decisions.
- [Reference fixtures](fixtures/README.md) — retained inputs and the facts they establish.
- [Native build guide](crates/photoctl-image/ort/README.md) — runtime acquisition and platform constraints.

## Releases

Version tags drive package and model publication together. A CLI release downloads
its own verified model files, never a moving “latest” model. Libraries can explicitly
select a mirror through [library settings](specs/photoctl/slices/09-settings.md).
[Release ownership](specs/photoctl/slices/14-gold-exam-and-release.md#model-distribution)
describes the publication boundary; the full local suite remains a release-preparation
responsibility, separate from the hosted release checks.
