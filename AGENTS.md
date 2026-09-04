# Coding conventions and best practices

Follow the main project readme (`README.md` in the root folder) on coding
conventions and best practices; it documents how to run tests, linters, and
the closeout gates. If any folder you're working in contains a `README.md`,
read it before continuing — the readmes are written for you.

## Where decisions live

Feature plans live in `specs/<feature>/README.md`; finished ones in
`specs/done/`. A plan's decision ledger is a set of givens — do not re-decide
them. If the code forces a deviation, log it in that plan's implementation
notes (what the plan said, what the code revealed, the conservative call) and
keep going.

Do not re-solve problems the sibling repos already solved. `~/dev/duet-agent`,
`~/dev/duet`, and `~/dev/game` are precedent for conventions, infrastructure,
and — above all — tests. Lift and cite; the owning spec says what to adapt.

## Communicating with the user

The user is very technical but doesn't read the code day-to-day. Responding in
code or pointing at files is fine — just don't assume they already know what a
given variable, function, or module does; introduce it briefly on first mention.

API seams and schemas are the most important things to surface: when work
touches an interface between components (CLI output contracts, provider
interfaces, native-addon boundaries, database schemas, module boundaries),
lead with what that contract looks like and how it changed.

## Testing changes

Before implementation work on behavior changes or bug fixes, invoke
[`write-tests`](.agents/skills/write-tests/SKILL.md) and follow its red/green
TDD workflow. Tests are **functional**: drive the real CLI as a real process
against real state inside the Docker seam. Unit tests are reserved for
genuinely tricky pure logic.

`fixtures/` holds committed known-good/known-bad assets; `fixtures/README.md`
says what each proves — add a line when you add a file. One-off probes go in
`throwaway/` (gitignored) or the `dbg*` test buckets, never in the suite.

### Run the narrowest runner that answers your question

The root test script is a **closeout gate, not a feedback loop** — it boots the
Docker seam and runs every package. While iterating, run the narrowest thing
that covers your change from the package that owns the code: one test, one
file, the owning package. The root run belongs at the end of an implementation
— before a handback, before a merge, as the last gate of a spec.

## Visual output

Rendered images, previews, contact sheets, and diff reports are visual. Use
[`screenshot-critique`](.agents/skills/screenshot-critique/SKILL.md) for an
unprimed second opinion on any rendered output and
[`compare-screenshots`](.agents/skills/compare-screenshots/SKILL.md) to judge a
candidate against a reference or a prior render.

## Big changes end with their closeout gate

Every feature spec names its closeout gate (an end-to-end exam, a live journey).
Run it once at the end of the work, not as a loop.
