# Library-independent discovery

Add root help and recognized command help before any library, daemon, model or
credential work, including configure's stdin path. Support `openphoto --help`,
`openphoto help`, `openphoto help COMMAND` and `openphoto COMMAND --help`.
Unknown targets report a useful usage error without requiring a library.
Default help is machine-readable through the existing envelope; `--human` is
readable usage. Empty invocation may show root help. Preserve established
configure/settings help contracts and actual command execution behavior.

Use one inventory joining command names, dispatch adapters and descriptive help;
do not build another CLI framework or copy a roster into README. Execution
parsers remain authoritative for validation; review all help against them.
Describe every public command and meaningful subcommand, options and examples.

Root README links to a concise workflow guide. The guide explains discovery,
library selection, identifiers, coordinate frames, JSON/stdout and stderr events,
human output, editing/history/export, credentials and model provisioning. Precise
syntax lives in executable help. Segment help explains text target versus click
instance choice, repeated points, no-match/ambiguity, `--norm`, dry-run, manual
shapes and refinement. Doctor help explains explicit pinned model acquisition,
per-library storage, cached reuse and mirror selection.

Red/green through the built CLI: root and segment help succeed with an absent
library and no credentials, produce useful values and create no files/daemon.
Exercise human help, invalid targets and nested command discovery. Preserve
existing configure/settings tests and normal dispatch tests. No visual output.

Delegated: help module organization, descriptive wording and representative
workflow examples. No new product options, parser semantics or schema migration.
