# 02 — daemon contention and human CLI output

Sub-slices: **2a** daemon runs `dispatch`, real N-process contention, `tag` (implemented) · **2b** global human renderer.

## Contract unlocked
D6 on Node 24: every command reaches an auto-started daemon that executes `commands.dispatch` unless `--no-daemon`;
N real processes never lose a row; over capacity fails loudly with one code. Verdict `assets/gates/G1-concurrency.txt`.
The CLI can render the same typed envelopes for a person without changing their machine contract (D10).

## API seam
- `apps/daemon/src/{server.ts,workers/index.ts}`: length-prefixed JSON frames `CommandRequest → Envelope` (+ streamed
  `events`) over `$TMPDIR/photoctl-<sha1(libPath+version+schema)[:8]>.sock` (flat file, ≤104 bytes, never in the library);
  ONE PGlite instance; requests execute serially through a queue capped at `settings.daemon_queue_max` (8); a request that
  waits past `lockBudgetMs` → `library_locked` 75. `registerBackground(name, isBusy)` suppresses idle-exit
  (`settings.daemon_idle_ms` = 15 min) while any worker is busy; unmount watcher → graceful stop; on stop the lock is released.
- `packages/commands/src/daemon-client.ts`: `ensureDaemon(lib)`: read the lock payload → if `socket` set and pid alive, connect;
  if the holder is a photoctl daemon of another version, send `stop`, wait, respawn; if lock free, take it, spawn (daemon
  rewrites the payload with its pid + socket), connect; spawn fails → `daemon_unavailable` 69. `--no-daemon`: if a daemon
  holds the lock, send `stop` and wait, then run `dispatch` in-process under the lock.
- Batch semantics: ids are resolved before the transaction; the found subset commits; per-item `results` reflect it.
- Verbs: `daemon start|stop|status` → `{pid,socket,uptime_s,queue,version}`; `tag <id...> --add|--remove <tag>` (the row-append
  primitive the race uses; `tags(photo_id, tag, pk)` migration, next number).
- `probe:race` (from `assets/concurrency-spike/boundary.sh`, spawning the real CLI) → `out/wb/race.html` + G1 verdict.
- **2b** `apps/cli/src/output.ts`: `--human` is a global presentation option removed before `CommandRequest` construction.
  JSON remains the default. After local or daemon execution returns the same `Envelope`, the CLI renders success fields and
  warnings as deterministic text, failures with their stable code and message, and batch/partial results as one row per input
  plus the summary. Exit codes and stderr NDJSON events do not change. Commands and protocol verbs contain no human-formatting
  branches; the future `--stream` mode remains NDJSON rather than passing through this renderer.

## Human can run
`photoctl daemon status`; `bun run probe:race -- --clients 8 --rows 25` → 200/200; `wb race`.

## Verification
`concurrency-race.test.ts`: 8×25 `tag --add p<i>-<j>` → exactly the 200 expected tag *values*; 24 clients with queue 8 → every
failure is `library_locked` 75, rows == 25 × successes. `daemon-lifecycle.test.ts`: stale socket + dead pid → respawn once; live
foreign version → stop + respawn; `--no-daemon` with a live daemon → daemon stops, command succeeds; `kill -9` mid-run → next
command respawns; 200-char library path → socket ≤ 104 bytes. `fresh-open.test.ts` (8 `init`s on one path → migrations ran once,
no lock left). Budgets via `PHOTOCTL_LOCK_BUDGET_MS`/`PHOTOCTL_POLL_CEILING_MS`, derived from measured spawn. Perf band (in
`test:macos`): warm `show` p50 < 250 ms over 20 runs.
`human-output.test.ts`: real CLI success, failure, and mixed partial envelopes produce readable non-JSON output while the same
commands without `--human` retain byte-parseable JSON and identical exit codes/data outcomes.

## Delegated: frame encoding detail; log file location; human-table column widths.
## Checkpoint: `wb race` — refusal wording only.
## Must stay green: 01 (harness runs it with and without `PHOTOCTL_NO_DAEMON`). Deps: 2a ← 01b; 2b ← 2a.
## Firewall: no background workers yet; human output never changes envelopes or stderr events.

## Implemented

The daemon owns one inherited advisory lock and one persistent PGlite handle. Commands use four-byte
big-endian length-prefixed JSON frames; request events stream before the final envelope. `tag` resolves
the complete input batch before its transaction and commits every resolvable item with idempotent
add/remove semantics. Version mismatch, dead/stale sockets, unclean daemon death, explicit no-daemon
execution, idle suppression hooks, and library removal all have real-process coverage.

Integration review made the durable initialization result authoritative: a failed optional daemon start is a warning, so retry
does not collide with an already-created library. Status comes from a live control response; stop refuses success until the owner
exits; idle sockets do not consume framed-request capacity. The Unix socket and current-run log are owner-only, and daemon restarts
truncate the prior log.

`bun run probe:race -- --clients 8 --rows 25` produced the committed G1 PASS verdict with 200 accepted
and 200 persisted exact tag values. The 24-client overload test proves every refusal is
`library_locked`/75 and accepted batches commit in full. Host performance covers 20 warm `show` calls
with p50 below 250 ms; lock and poll budgets are derived from a measured Node process spawn.

The `wb race` report uses the retry copy “Library busy — retry this command.” Browser security blocked
opening its local `file:` URL during closeout, so the wording is test-pinned but the visual checkpoint
remains pending in an environment that can open the generated report.
