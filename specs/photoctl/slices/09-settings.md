# 09d — public library settings

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
The typed setting registry owns the supported keys and their validation; include
the existing models, generation, providers, models_base_url, embed_mode and
cache_max_bytes settings. Do not expose arbitrary database keys or store secrets.
Unknown fields must fail rather than appear to save successfully and disappear.

Reuse the current settings table and existing value schemas, moving shared schemas
to the protocol leaf if needed so readers and writers cannot disagree. No new
table, migration, global configuration file, dotted-path patch language or service.
Setting a mirror does not fetch models; saving model defaults does not execute a
provider. Explicitly setting automatic embedding grants the existing consent;
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
