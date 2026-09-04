# 15 — optional MCP facade (unspecified until real)

Not planned in detail. When it becomes real, this slice must specify: tool naming, transport (stdio), the mapping of
multi-id `partial` to MCP errors, stderr events → progress notifications, and value-level tests on a fixture library for at
least five verbs. Constraint: `apps/mcp` calls `commands.dispatch`; no verb, parameter, or DB access the CLI lacks.
