# Coding conventions and best practices

Follow the main project readme (located in `README.md` in the root folder) on
coding conventions and best practices. It also documents how to run tests,
linters, and the closeout gates.

If any folder you're working in contains a `README.md`, read it before
continuing — the readmes are written for you.

## Communicating with the user

The user is very technical but doesn't read the code day-to-day. Responding
in code or pointing at files is fine — just don't assume they already know
what a given variable, function, or module does; introduce it briefly on
first mention.

API seams and schemas are the most important things to surface: when work
touches an interface between components (CLI output contracts, provider
interfaces, native-addon boundaries, database schemas, module boundaries),
lead with what that contract looks like and how it changed.

## Testing changes

Before implementation work on behavior changes or bug fixes, invoke
[`write-tests`](.agents/skills/write-tests/SKILL.md) and follow its red/green
TDD workflow. Use it for test additions or revisions too.

Tests are functional: they drive the real CLI as a real process against real
state inside the Docker seam. `fixtures/` holds committed known-good/known-bad
assets (`fixtures/README.md` says what each proves — add a line when you add a
file). One-off probes go in `throwaway/` (gitignored), never in the suite.

### Run the narrowest runner that answers your question

The root test script is a **closeout gate, not a feedback loop.** It boots the
Docker seam and runs every package, so it is the slowest thing in the repo and
almost none of it is about the file you just edited.

While iterating, run the narrowest thing that covers your change from the
package that owns the code — one test, one file, the owning package — and stop
at the first rung that answers your question. The root run belongs at the
**end of an implementation** — before a handback, before a merge, as the last
gate of a spec. One run, not one per pass.

## Visual output

Whenever doing anything visual — rendered images, previews, contact sheets,
diff reports — use
[`screenshot-critique`](.agents/skills/screenshot-critique/SKILL.md) for an
unprimed second opinion and
[`compare-screenshots`](.agents/skills/compare-screenshots/SKILL.md) to judge
before/after shots.

## Big changes end with their closeout gate

A large enough change — a full spec, a major feature — ends by running the
closeout gate its spec names (an end-to-end exam, a live journey) once, before
calling the work done. Do not run it as a feedback loop.
