# G3 — CIRAW headless verdict

**Verdict: blocked by host configuration, not a CIRAW failure.**

On 2026-09-04, `photoctl-mac` decoded `fixtures/a7c2.ARW` twice through the macOS host test with identical
RGB-f32 bytes at quarter scale. The output was 1752×1168, 24,556,032 bytes, using Core Image decoder 8;
the independently repeated local output had MD5 `9c1b1d922672dd4ef516d151bff35450`.

The stricter `bun run probe:headless-ciraw` gate could not start because this Mac refuses SSH connections
to `localhost:22` (Remote Login is disabled). Until that script runs from a session without a window
server, `doctor` reports `requires_window_server:null`. A successful run changes that field to `false`; a
CIRAW render failure changes it to `true` and makes LibRaw the automatic runtime decoder.
