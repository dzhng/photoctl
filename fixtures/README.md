# fixtures/

Known-good and known-bad assets, committed to git, used by the functional test suite.
Every file here has one line saying what it proves. Add a line when you add a file.

| File | Kind | Proves |
|---|---|---|
| `a7c2.ARW` | known-good | Sony ILCE-7CM2, uncompressed ARW, 7008×4672, `OffsetTimeOriginal +02:00`, embedded JPEGs at 160×120 / 1616×1080 / 7008×4672. Decode, locator, content key, timezone rule, preview tiers, identity export. |

Wanted (see specs/photoctl/README.md OPEN items): one A7C II frame per compression mode (Lossless L / M / S, lossy), a portrait-orientation frame, a Lightroom Classic `.xmp` sidecar, a truncated ARW (known-bad: import must report `unsupported`, never crash).
