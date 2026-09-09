# OpenPhoto installation and live-provider verification

The public product and command are OpenPhoto / `openphoto`, published as
`@dzhng/openphoto`. The repository and private implementation package names may
remain photoctl. Credentials belong in the user's `~/.openphoto/.env`, separate
from photo catalogs, with a CLI configuration command instead of shell setup.

## Next Agent Prompt

Updated 2026-09-09. The hardened runner and real execution are recorded in
[verification](verification.md). Publication is paused; no tag, release or push
was performed. Installation, saved credentials and packed-install checks pass.

Finish the provider output-size correction, then rerun only masked editing.
The native-mask probe changed protected pixels; GPT Image 2 now explicitly uses
the existing local-compositing strategy, within the spec's transport-correction
scope. Native polarity remains unverified. The targeted live request reached the
provider but requested 384×384 output, below the model's documented minimum.
A separate worktree owns size negotiation and truthful output-size provenance.

The runner now independently compares protected linear pixels and replays a
purchased masked result offline; both pass against the fixture. Strict fit keeps
the proof's protection boundary identical to its authored selection. Auto-enhance
passes live after allowing longer structured analysis, without changing other
provider deadlines. Saved-key rotation on the same daemon and invalid-input
preservation are now directly tested. After real masked acceptance, run the full
local gate once, consolidate choices and close the spec.

- [x] Installed name and private saved credentials, including terminal input.
- [x] Explicit live-provider integration script and authorized real execution.
- [x] Resolve live auto-enhance timeout and credential-verification gaps.
- [ ] Complete live masked-edit acceptance.
- [ ] Review, documentation and one full local closeout gate.

The prior review also fixed the CLI test driver's implicit use of developer
credentials. Ordinary tests are keyless unless they opt into fixture credentials.

## Evidence

Focused checks cover private configuration and rotation, hidden terminal input,
native publication order, version pin synchronization, embedding worker consent,
cancellation and foreground latency during a 1,500-photo drain. The retained
[live embedding report](assets/embed-shape.json) uses the production adapter and
synthetic images, without a saved real-home credential. This establishes image
consumption and transport, not search quality or photographic segmentation.
The [live CLI evidence](verification.md) separates accepted transport/replay
from native-mask failure and visual limitations. The [choices ledger](choices.md)
records decisions not specified by the user.

## Contracts and boundaries

- Configuration is local, library-independent and makes no provider calls.
  Input is hidden interactively; automation uses stdin or its current environment,
  never a credential argument. The file is plaintext, owner-readable/writable;
  its directory is owner-only. Replacement preserves unrelated dotenv values.
- Explicit process environment wins, including an empty value. Normal requests
  read saved credentials anew before direct execution or daemon dispatch. Existing
  background work is not cancelled; a daemon adopts changed credentials with its
  next foreground request, not a filesystem watcher or restart requirement.
- Repo paths, existing catalog locations and `PHOTOCTL_*` controls are not renamed
  as a side effect. Separately published native dependencies use `@dzhng` too;
  installed resolvers and release artifacts must agree. No migration or alias layer.
- Live verification is a deliberate command outside default tests and hosted CI.
  Use disposable catalogs/homes and retained or synthetic fixtures, finite timeouts
  and a small serial scenario list. Never automatically rerun paid mutations.
  Estimates are not hard cost ceilings. Failure evidence must not contain secrets.
- The user authorized the staging AI Gateway credential in `~/dev/duet/.env.staging`.
  Follow that repo's dotenvx instructions; decrypt in a child process without
  printing credentials, copying `.env.keys`, or changing Duet. Do not save the
  testing credential to the user's real home unless separately requested.
- Camera contents remain untouched. Mac acceptance and smoke-only hosted CI stay
  unchanged. No public npm release/tag action is authorized by this implementation.

## Planning evidence

Three independent read-only drafts (minimal ladder, risk-first, seam ownership)
converged on two slices. The seam audit added explicit background-key adoption
semantics; the risk audit separated successful transport from photographic/mask
quality. Claude independently inventories existing live adapters/scripts.
The reference release workflows in `~/dev/duet-agent` and `~/dev/factory` both
publish with `NODE_AUTH_TOKEN` from `NPM_TOKEN`; the current tag workflow already
does this. Preserve its platform/model packaging rather than copying a different
project's deployment machinery.

Run focused tests during development and `bun run verify` once at final closeout.
Visual evidence requires `compare-screenshots` and an unprimed
`screenshot-critique`; HTTP success alone never establishes mask polarity or
photographic quality. Use `review` and `audit-choices` before committing passes.
