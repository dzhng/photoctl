# Agent preview loop evidence

This keyless capture follows one 1920×1280 document through global exposure (H1), a filled person region (H2), and 50% layer opacity (H3). `detail-sequence.png` presents those native-coordinate crops left to right; `h1-h2-absdiff.png` makes the fill boundary visible. The full masters, final overview, and independently decoded export preserve the evidence needed to revisit either scale.

The measurements in `metrics.json` support the mechanical verdict: the fill is concentrated in the selected rectangle and preserves an independently chosen protected pixel, H3 follows the expected linear-light blend, and the export represents H3. The exaggerated difference image also reveals the faint codec halo expected from a lossy JPEG review view; canonical unmasked bit-exactness is owned by the compositor test, not this visual oracle. The fake provider intentionally returns a flat synthetic fill. These captures therefore establish preview freshness, cache reuse, placement, and export continuity—not live-model texture or photographic quality.

Regenerate the source, masters, crops, overview, and export while running the public-CLI journey (the montage, difference image, and metrics are review artifacts derived from that capture):

```bash
PHOTOCTL_AGENT_PREVIEW_CAPTURE_DIR=specs/photoctl/assets/agent-preview-loop \
  node node_modules/vitest/vitest.mjs run --config vitest.config.ts \
  apps/cli/src/agent-preview-loop.test.ts
```
