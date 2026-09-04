# 15 — optional MCP facade

`apps/mcp` exposes the same verbs by calling `protocol.dispatch` — no new verb, parameter, or DB access.
Verification: contract-equivalence test (every verb's Zod data shape returned identically via CLI and MCP).
Deps: 14. Firewall: MCP adds nothing the CLI lacks.
