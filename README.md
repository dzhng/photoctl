# photoctl

A CLI-first photo library and editor for photographers and agents. The complete workflow
must be usable without a screen. Human and machine interfaces share the same capabilities;
a future GUI must not become a separate product with exclusive features.

## Principles

- **Preserve originals.** Editing is non-destructive. The library owns editing state;
  writing metadata back beside source photos is always explicit.
- **Make limitations visible.** Continue when usable work is possible, and report degraded
  or unavailable inputs honestly rather than silently changing the result.
- **Generate only what must be invented.** Deterministic restoration and geometry stay
  local; they do not need a generative service.
- **Guarantee fidelity.** Pixels outside a masked edit are preserved by the application,
  not by trusting a model to leave them alone.

## Verification policy

GitHub CI provides fast feedback through lint, typechecking and a small smoke-test subset.
The full suite belongs in local development and deliberate release verification, not on
every push. A green GitHub check is not release acceptance; keep full local coverage intact.

Use focused tests while iterating and the full local gate at implementation closeout.
Do not optimize product code or weaken product requirements merely to fit a hosted runner.

## Where things live

- [Development plan](specs/photoctl/README.md) — current status, requirements and decisions.
- [Contributor guidance](AGENTS.md) — coding and testing conventions.
- [Reference fixtures](fixtures/README.md) — retained inputs and the facts they establish.
- [Project commands](package.json) and [CI workflow](.github/workflows/ci.yml) — executable checks.
- [Native build guide](crates/photoctl-image/ort/README.md) — runtime acquisition and platform constraints.
