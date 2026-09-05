# Retouch journey evidence

This keyless fixture isolates one visible variable: a circular retouch removes the red square from a smooth color gradient. `before`
is the native preview before the command, `after` is the native preview of the committed retouch revision, and `export` is an
independently decoded PNG export of that same render hash. The `-detail` files are nearest-neighbor crops for seam inspection; they
do not stand in for the canonical full-frame artifact.

Regenerate the set with:

```bash
PHOTOCTL_RETOUCH_CAPTURE_DIR="$PWD/specs/photoctl/assets/retouch-journey" \
  node node_modules/vitest/vitest.mjs run apps/cli/src/retouch-journey.test.ts
```

The test also reads the canonical linear artifacts to prove exact equality at every sample outside the stored circular mask and at
least one changed sample inside it. Preview-to-export mean absolute byte difference is bounded independently so a cached preview
cannot masquerade as the current export state.
