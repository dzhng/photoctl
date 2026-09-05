# fixtures/

Known-good and known-bad assets, committed to git, used by the functional test suite.
Every file here has one line saying what it proves. Add a line when you add a file.

| File | Kind | Proves |
|---|---|---|
| `a7c2.ARW` | known-good | Sony ILCE-7CM2, uncompressed ARW, 7008×4672, `OffsetTimeOriginal +02:00`, embedded JPEGs at 160×120 / 1616×1080 / 7008×4672. Decode, locator, content key, timezone rule, preview tiers, identity export. |
| `libraries/schema-v1.pgsql` | known-good | A real pgDump of the settings-only schema upgrades without losing library `0199a7c2-0000-7000-8000-000000000001` or its cache/daemon settings. |
| `libraries/schema-v2.pgsql` | known-good | The current photo, volume, locator, and pinned-cache schema preserves the `a7c2` fixture facts. |
| `libraries/schema-v3.pgsql` | known-good | The daemon settings and exact tag identity survive later schema upgrades. |
| `libraries/schema-v4.pgsql` | known-good | Promoted sampled identity, cull state, tags, and XMP read state survive the graph migration. |
| `libraries/schema-v5.pgsql` | known-good | The immutable graph schema preserves a pinned active source revision without requiring an execution artifact. |
| `libraries/schema-v6.pgsql` | known-good | Export history preserves delivered paths, immutable render identities, timestamps, and byte counts. |
| `libraries/schema-v7.pgsql` | known-good | Provider executions extend immutable graph provenance without replacing the graph owner. |
| `libraries/schema-v8.pgsql` | known-good | Search documents, half-vector embeddings, and provider-consent settings survive the layer-schema upgrade. |
| `libraries/schema-v9.pgsql` | known-good | Stable layer identities, immutable layer snapshots, and typed base/output revision roots survive the solid/vacancy upgrade. |
| `models.json` | release contract | Pins the SAM 2.1 source revision and exported ONNX opsets. Null hashes and `awaiting_export` deliberately make fetch/build fail until the real export is published. |
| `xmp/classic.xmp` | known-good | A Classic-style sidecar exercises rating, label, flat and hierarchical keywords, and photoctl's namespaced flag. |
| `tools/drive.mjs` | generator | `fixtures:drive -- --count N --out DIR` creates deterministic tail-distinct ARW copies and matching Classic-style sidecars. |
| `tools/volume.mjs` | host generator | `fixtures:volume -- --path FILE --mount DIR` creates and attaches a macOS APFS disk image for real offline-volume checks. |

Wanted (see [the photoctl spec](../specs/photoctl/README.md#known-unknowns-open-on-the-map-and-where-they-land)): one A7C II frame per compression mode (Lossless L / M / S, lossy), a portrait-orientation frame, and a truncated ARW (known-bad: import must report `unsupported`, never crash).

Generate the independent machine-readable facts with `python3 fixtures/tools/manifest.py`.
Generate the pinned segmentation artifacts with `scripts/export-sam2.py`; it writes real hashes only after both ONNX files have been exported and inspected.
