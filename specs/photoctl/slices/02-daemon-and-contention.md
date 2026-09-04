# 02 — daemon auto-start, socket transport, real N-process contention

## Contract unlocked
D6 on Node 24: every command goes through an auto-started daemon unless `--no-daemon`; N real
`photoctl` processes never lose a row; over capacity fails loudly (`library_locked`/`daemon_unavailable`),
never silently. Verdict file `specs/photoctl/assets/gates/G1-concurrency.txt`.

## API seam
- `apps/daemon/src/{server.ts,workers.ts}`: `PGLiteSocketServer({db, path, maxConnections})` (seed:
  `assets/concurrency-spike/daemon.mjs`); transports `CommandRequest` frames to `protocol.dispatch`;
  `registerBackground(name, isBusy)` hook suppresses idle-exit while any worker reports non-empty (09 uses it);
  unmount watcher → graceful stop; idle-exit 15 min (data in `<lib>/daemon.json`).
- `packages/library/src/daemon-client.ts`: `socketPath(lib) = $TMPDIR/photoctl-<sha1(libPath+version+schema)[:8]>.sock`
  (≤104 bytes, never inside the library); `ensureDaemon()`: take the file lock → stat socket → `kill -0` pid
  from `<sock>.pid` → respawn once → else `daemon_unavailable` 69. `LibraryHandle` over `pg.Client` = second
  transport, same interface. Writes are sent as one `BEGIN…COMMIT` batch per verb.
- `withDb`-style helper returns `{ok:true,value}|{ok:false,code:"library_locked",...}` — never `undefined`
  (duet `session.ts:191-195`); fix the `openWithPolling` lock leak (`session.ts:203-213`) with try/finally.
- Verbs: `daemon start|stop|status`; stderr `{"event":"daemon","action":"spawned|reused|exited",pid,socket,version,schema}`.
- `probe:race` (from `assets/concurrency-spike/boundary.sh`) writes `out/wb/race.html` and the G1 verdict.

## Human can run
`photoctl daemon status`; `bun run probe:race -- --clients 8 --rows 25` → rows 200/200; `wb race`.

## Verification
- `concurrency-race.test.ts`: N=8×25 `photoctl tag <id> --add p<i>-<j>` → exactly the 200 expected tag
  *values*; N=24 with `maxConnections=8` → every failure is 75/69 with a code, rows == 25 × successes.
- `daemon-lifecycle.test.ts`: stale socket + dead pid → respawn once; live foreign pid → reuse; `--no-daemon`
  while daemon holds the lock → 75 with `holder_pid`; kill -9 mid-run → next command respawns and succeeds;
  200-char library path → socket still ≤104 bytes.
- `fresh-open.test.ts` (port of `memory-session-concurrent-fresh-open.test.ts:36-78`): 8 `init`s on one path →
  migrations ran once, no lock left.
- Budgets injectable (`PHOTOCTL_LOCK_BUDGET_MS`, `PHOTOCTL_POLL_CEILING_MS`); harness measures Node spawn once
  and derives them. Perf band: `photoctl show` p50 < 250 ms warm over 20 runs.

## Delegated: idle timeout value; log location; whether `doctor` restarts the daemon.
## Checkpoint: `wb race` — capacity default 8 and refusal wording. Silent ⇒ keep if G1 passes.
## Must stay green: 01 (run twice: daemon and `--no-daemon`). Deps: 01. Firewall: no background work besides the socket.
