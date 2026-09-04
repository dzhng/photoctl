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
touches an interface between components (endpoints, message shapes, database
schemas, module boundaries), lead with what that contract looks like and how
it changed.

## Testing changes

Before implementation work on behavior changes or bug fixes, invoke
[`write-tests`](.agents/skills/write-tests/SKILL.md) and follow its red/green
TDD workflow. Use it for test additions or revisions too.

### Run the narrowest runner that answers your question

`bun run test` at the repo root is a **closeout gate, not a feedback loop.**
The functional tests boot the Docker seam and drive the real CLI as real
processes — so a full run is heavy and saturates the machine. It is
also the slowest thing in the repo by an order of magnitude, and almost none of
it is about the file you just edited.

While iterating, work from the top of this ladder and stop at the first rung
that covers your change. Run these from the package that owns the code:

```bash
bun test src/foo.test.ts -t 'the case I broke'   # one test
bun test src/foo.test.ts                          # one file
bun test --changed                                # every test file whose
                                                  # import graph reaches your
                                                  # uncommitted edits
bun run test                                      # the owning package
```

`--changed` is the default reach-for once a change spans more than one file: it
walks the import graph, so it picks up the tests you would have forgotten, and
it stays honest about the ones your edit cannot reach. `--changed=<ref>`
compares against a branch or commit instead of the working tree — use it to
sweep a whole branch (`bun test --changed=origin/main`) without paying for
the packages the branch never touched. From the repo root,
`turbo run test --filter=<package>` scopes the gate to one workspace.

The root `bun run test` belongs at the **end of an implementation** — before a
handback, before a merge, as the last gate of a spec. One run, not one per
pass. If you need it more than once in a session, you are using it as a
feedback loop; go back up the ladder.

## Visual output

Whenever doing anything visual, use
[`screenshot-critique`](.agents/skills/screenshot-critique/SKILL.md) for an
unprimed second opinion and
[`compare-screenshots`](.agents/skills/compare-screenshots/SKILL.md) to judge
before/after shots.

## Big changes end with their closeout gate

A large enough change — a full spec, a major feature — ends by running the
closeout gate its spec names once, before calling the work done. Do NOT run
it as a feedback loop; reserve it for the end of the work.
