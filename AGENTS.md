# Coding conventions and best practices

Shell for now — grows as the project does. Localized from `~/dev/duet/AGENTS.md`.

Follow the main project readme (`README.md` in the root folder) on coding
conventions and best practices; it documents how to run tests, linters, and
the gold exam. If any folder you're working in contains a `README.md`, read it
before continuing — the readmes are written for you.

## Where decisions live

`specs/photoctl/README.md` is the plan; its decision ledger (from the
/explore-unknowns map at `specs/photoctl/visualizations/map.html`) is a set of
givens. Do not re-decide them. If the code forces a deviation, log it in the
spec's implementation notes (what the plan said, what the code revealed, the
conservative call) and keep going.

Do not re-solve problems `~/dev/duet-agent` already solved — PGlite
single-writer locking, session lifecycle, recovery, the embedding worker, and
**their tests**. Lift and cite them; the spec's port cards say what to change.

## Communicating with the user

The user is very technical but doesn't read the code day-to-day. Responding in
code or pointing at files is fine — just don't assume they already know what a
given variable, function, or module does; introduce it briefly on first mention.

API seams and schemas are the most important things to surface: when work
touches an interface between components (the JSON envelope, the provider
interface, the decoder interface, the layer model, the PGlite schema, module
boundaries), lead with what that contract looks like and how it changed.

## Testing changes

Before implementation work on behavior changes or bug fixes, invoke
[`write-tests`](.agents/skills/write-tests/SKILL.md) and follow its red/green
TDD workflow. Tests are **functional**: they drive real `photoctl` processes
against a real library directory inside the Docker seam. Unit tests are
reserved for genuinely tricky pure logic (develop-key tiering, transform
composition, the timezone parser).

`fixtures/` holds committed known-good/known-bad assets; `fixtures/README.md`
says what each proves. Add a line when you add a file. One-off probes go in
`throwaway/` (gitignored) or the `dbg*` test buckets, never in the suite.

### Run the narrowest runner that answers your question

The root test script is a **closeout gate, not a feedback loop** — it boots the
Docker seam and runs every package. While iterating, run the narrowest thing
that covers your change from the package that owns the code: one test, one
file, the owning package. The root run belongs at the end of an implementation
— before a handback, before a merge, as the last gate of a spec.

## Visual output

Exports, previews, contact sheets, and decoder-oracle diffs are visual. Use
[`screenshot-critique`](.agents/skills/screenshot-critique/SKILL.md) for an
unprimed second opinion on any rendered image and
[`compare-screenshots`](.agents/skills/compare-screenshots/SKILL.md) to judge a
candidate against a reference or a prior render.

## Big changes end with the gold exam

The gold exam (`specs/photoctl/README.md`) is the closeout gate for any large
change: import ARWs `--link` → list → rate → develop `--preset people` → export
JPEGs, with no gateway key present. Run it once at the end, not as a loop.
