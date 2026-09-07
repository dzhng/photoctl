# 09d — public library settings

Implemented through the built and freshly installed CLI. The
[closeout evidence](../assets/settings-closeout-2026-09-07.md) records the focused
checks and review boundary; public release/platform acceptance is separate.

## Contract

The CLI-first workflow must not require SQL to select a model mirror, save model
defaults or grant/revoke automatic provider consent. Expose the existing user
settings through the ordinary command/daemon boundary; keep library identity and
internal cursors private. This closes the deferred writer in slice 09, not a new
configuration system.

`settings get [key]` reads normalized saved values with their defaults (or all
user settings); model overrides remain overrides, while doctor owns resolved
provider diagnostics.
`settings set <key> <json>` validates and replaces one whole setting atomically.
`settings reset <key>` restores its normal initialization/default semantics.
The [typed setting registry](../../../packages/protocol/src/verbs/settings.ts)
owns supported keys and validation. Do not expose arbitrary database keys or store secrets.
Unknown fields must fail rather than appear to save successfully and disappear.

Reuse the current settings table and existing value schemas, moving shared schemas
to the protocol leaf if needed so readers and writers cannot disagree. No new
table, migration, global configuration file, dotted-path patch language or service.
Saving configuration makes no immediate download or foreground provider request;
existing automatic embedding consent still permits background work. Explicitly
setting automatic embedding grants that existing consent;
reset returns it to manual. Configured-upscaler consent retains its existing
meaning and does not select an adapter from ambient credentials.

## Verification

Use write-tests red/green through the public command boundary. Prove persisted
mirror configuration is consumed by doctor, invalid values leave prior state
unchanged, reset restores the version-matched release default, object replacement
does not silently merge old values, and internal identity cannot be overwritten.
Cover the actual daemon route and a fresh installed CLI without touching retained
libraries, the camera, or paid providers. Run focused owning tests, lint, types and
build; do not repeat the whole repository closeout as a feedback loop.

## Delegation

Internal factoring, response-envelope field names and test placement are delegated
to the implementer; follow adjacent public commands. Keep the change small and
review the command help and packaged entry point alongside persistence.
