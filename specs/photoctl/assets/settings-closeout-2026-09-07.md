# Public settings closeout

Implementation is integrated at `c40754b`. The public configuration surface uses
the existing settings table; no schema or migration was added.

- Implementation tests: 19 tests across seven focused files passed. Tracers first
  failed on the missing command and unsupported setting keys. Invalid-URL handling
  and response tolerance each failed before their corrections. Deliberately
  stripping unknown write fields failed the preservation assertion.
- Integrated checkout: five focused files / 11 tests passed in 17.21 seconds;
  TypeScript build, typecheck, lint and diff checks passed. Lint retains warnings,
  including intentional sequential state-test loops.
- Fresh optimized macOS ARM64 package: the standalone settings journey passed in
  30.49 seconds including preparation; the other nine cases were deliberately
  unselected. This is not a rerun of the complete packed file or full local suite.
- Small hosted-check equivalent: four files / ten tests passed locally.

The shared built/installed journey verifies saved values after daemon restart,
doctor's use of a mirror, reset to the running CLI version's release URL, and
no-daemon visibility. No model download, paid provider or camera access was needed.

Independent review found overly strict response parsing; the corrected response
schemas ignore additive fields while writes remain strict. Re-review was clean.
The separate Codex CLI review could not run because the installed CLI cannot use
its configured model; it supplied no verdict. No review tool was upgraded.
