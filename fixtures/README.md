# fixtures/

Known-good and known-bad assets, committed to git, used by the functional test suite.
Every file here has one line saying what it proves. Add a line when you add a file.

| File | Kind | Proves |
|---|---|---|
| `a7c2.ARW` | known-good | Sony ILCE-7CM2, uncompressed ARW, 7008×4672, `OffsetTimeOriginal +02:00`, embedded JPEGs at 160×120 / 1616×1080 / 7008×4672. Decode, locator, content key, timezone rule, preview tiers, identity export. |
| `a7c2-lossless-l.ARW` | known-good, CC0 | Full-resolution Sony lossless-L RAW decodes; its stored Compression=7 survives LibRaw's internal dispatch normalization. |
| `a7c2-lossy.ARW` | known-good, CC0 | Sony lossy compressed RAW (Compression=32767) preserves the same camera-space decoder contract. |
| `corrupt/a7c2-truncated.ARW` | known-bad | A genuine TIFF header and truncated first directory are skipped by public import without a crash or catalog photo. Its adjacent JSON records the exact source prefix and hash. |
| `libraries/schema-v1.pgsql` | known-good | A real pgDump of the settings-only schema upgrades without losing library `0199a7c2-0000-7000-8000-000000000001` or its cache/daemon settings. |
| `libraries/schema-v2.pgsql` | known-good | The current photo, volume, locator, and pinned-cache schema preserves the `a7c2` fixture facts. |
| `libraries/schema-v3.pgsql` | known-good | The daemon settings and exact tag identity survive later schema upgrades. |
| `libraries/schema-v4.pgsql` | known-good | Promoted sampled identity, cull state, tags, and XMP read state survive the graph migration. |
| `libraries/schema-v5.pgsql` | known-good | The immutable graph schema preserves a pinned active source revision without requiring an execution artifact. |
| `libraries/schema-v6.pgsql` | known-good | Export history preserves delivered paths, immutable render identities, timestamps, and byte counts. |
| `libraries/schema-v7.pgsql` | known-good | Provider executions extend immutable graph provenance without replacing the graph owner. |
| `libraries/schema-v8.pgsql` | known-good | Search documents, half-vector embeddings, and provider-consent settings survive the layer-schema upgrade. |
| `libraries/schema-v9.pgsql` | known-good | Stable layer identities, immutable layer snapshots, and typed base/output revision roots survive the solid/vacancy upgrade. |
| `libraries/schema-v10.pgsql` | known-good | A moved subject keeps its paired magenta vacancy, original selection, ordered layer snapshots and immutable graph through upgrade. |
| `libraries/schema-v11.pgsql` | known-good | An affine resample retains its version-2 matrix, ordered RGB input and layer placement through upgrade. |
| `libraries/schema-v12.pgsql` | known-good | A local retouch retains its heal recipe, prior-image input, selection and removable layer identity through upgrade. |
| `libraries/schema-v13.pgsql` | known-good | Versioned auto-enhance undo metadata on an immutable document revision survives later schema upgrades. |
| `libraries/schema-v14.pgsql` | known-good | A tagged standalone generated photo retains its zero-input generation recipe and provider provenance. |
| `libraries/schema-v15.pgsql` | known-good | Stable vector markup items and their photo ownership survive later schema upgrades. |
| `libraries/schema-v16.pgsql` | known-good | Derived mask fit parameters retain their original selection ancestry across schema upgrades. |
| `libraries/schema-v17.pgsql` | known-good | A realized execution frame keeps its source-tier coordinates even when its pixel artifact is unavailable. |
| `libraries/schema-v18.pgsql` | known-good | A pinned reference retains working RGB and encoded PNG artifacts before any source execution exists. |
| `libraries/schema-v19.pgsql` | known-good | Immutable geometry intent and per-layer authoring checkpoints survive a dump/restore; duplicating an earlier layer does not make it newly authored. |
| `libraries/schema-v20.pgsql` | known-good | Accepted and policy-rejected paid image attempts retain original artifacts, while only the accepted attempt links a render execution and photo. |
| `libraries/schema-v21.pgsql` | known-good | A translated border retains intrinsic pixel placement, immutable canvas bounds and support status, and authored geometry ancestry. |
| `models.json` | release contract | Pins the SAM 2.1 source revision, real CPU-parity-verified ONNX hashes, and opsets. Distribution location is configured separately; hashes do not assert model quality or runtime performance. |
| `xmp/classic.xmp` | known-good | A Classic-style sidecar exercises rating, label, flat and hierarchical keywords, and photoctl's namespaced flag. |
| `tools/drive.mjs` | generator | `fixtures:drive -- --count N --out DIR` creates deterministic tail-distinct ARW copies and matching Classic-style sidecars. |
| `tools/volume.mjs` | host generator | `fixtures:volume -- --path FILE --mount DIR` creates and attaches a macOS APFS disk image for real offline-volume checks. |

Wanted (see [the photoctl spec](../specs/photoctl/README.md#known-unknowns-open-on-the-map-and-where-they-land)): A7C II Lossless M / S frames and a portrait-orientation frame. Compression coverage does not substitute for real-drive acceptance.

The truncated fixture is the first 64 bytes of the uncompressed source, ending inside its declared
TIFF directory before any usable preview. This proves structured truncation rejection, not rejection
of every shortened RAW: a damaged RAW payload with an intact usable preview may still satisfy the
capability-based import contract. Known-bad files stay under `corrupt/`, outside the top-level
known-good decoder inventory. Their provenance records are not decodable-image manifests.

Each ARW's adjacent JSON is its manifest. Generate independent file/RAW-IFD facts with `python3 fixtures/tools/manifest.py <file>`;
authored provenance and behavioral baselines survive regeneration only for the same SHA-256. A changed or unpinned image
refuses to overwrite its old manifest; review its annotations and remove that manifest explicitly before generating new facts.
The generator targets these A7C II fixtures and their known preview sizes, not arbitrary RAW dimensions. `raw` records bytes from the selected Sony RAW SubIFD,
not decoder output. `libraw` separately pins decoded white-balance metadata. Exact decoded-pixel comparisons are scoped to
their measured host in the [compression evidence](../specs/photoctl/assets/gates/libraw-compression.json), not treated as
portable hashes or an independent photographic-quality oracle. Decoder suites discover the committed ARWs
and consume these same manifests rather than maintaining another compression-mode inventory.

The new compressed frames come from [raw.pixls.us](https://raw.pixls.us/), whose repository rows explicitly mark them CC0;
their manifests retain source URLs, repository dates, license and SHA-256. Together they add 86,089,728 bytes (~82.1 MiB) to
git. Keeping the originals makes decoder coverage offline and reproducible; resized/re-encoded substitutes cannot exercise
the RAW codecs. SonyRawFileType=4 identifies lossless compressed RAW 2 according to [ExifTool's tag documentation](https://exiftool.org/TagNames/EXIF.html);
the 7008×4672 default crop matches [Sony's full-frame L specification](https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7cm2/specifications).
The repository's 4:3 label is not proof of the developed aspect ratio or M/S coverage; the crop is read from the file.

Historical SQL fixtures freeze schema and writer contracts, not old PostgreSQL binaries. The v10–v12
dumps were produced by running the migration runner and graph/layer writers from `bf93625`, `693c526`,
and `e3d2b38` respectively against fresh PGlite databases, then using real `pgDump`. They were not
made by relabeling a current database or removing newer migrations from one. The schema-version ledger
is the historical runner's output. UUIDs and timestamps are original writer output retained in the dump.

Their small source photo is a metadata fixture: each historical writer creates a box selection at
`[2,3,4,5]` in a 16×12 frame and moves it by `[3,-2]`. The v11 writer additionally commits an affine
resample on the subject's RGB branch, retaining the selection and rebuilding the composite through
its layer projection owner. The v12 retouch writer adds a radius-2 circle at `[8,6]`. Exact recipes and
upgrade assertions live in [`migrate-upgrade.test.ts`](../packages/library/src/migrations/migrate-upgrade.test.ts).
Mask artifacts were published during authorship but are not included in these metadata-only dumps;
this coverage proves retained graph records, not recoverable pixel files or photographic correctness.
As with production restore, tests reset the session search path after loading a real pgDump.

The `sam_probes` annotations in `a7c2.json` are authored from visible subjects, not model outputs.
Remeasurement preserves them only while the image SHA-256 is unchanged. Their area bands test coarse
selection, not edge quality; [photographic evidence](../specs/photoctl/assets/sam-photographic/README.md)
records that separate verdict. The shared `test/model-runtime` suite is part of both the default
Docker functional gate and the default macOS suite, in addition to their existing tests. Missing
models or an empty test selection fail visibly; the narrow `test:models` script is a diagnostic,
not a replacement for those defaults.

Docker takes an explicit `PHOTOCTL_MODELS_BASE_URL`, fetches and verifies the manifest's files during
the functional image build, and exposes that directory to the tests. The gateway fixture uses the
built application image without fetching models. Public distribution is not configured: a real
release host or a reachable local HTTP server serving the frozen exports is still required.
CI and release tests read that URL from the GitHub repository variable of the same name; an unset
variable remains a prerequisite failure, not a request to skip model coverage.

On a host, set `PHOTOCTL_SAM_MODELS_DIR` to an existing exported directory. To provision from a
configured base URL, build the TypeScript packages and use the same fetch owner as Docker:

```sh
node scripts/fetch-models.mjs "$PHOTOCTL_MODELS_BASE_URL" /path/to/models
PHOTOCTL_SAM_MODELS_DIR=/path/to/models bun run test:macos
```

Generate the pinned segmentation artifacts with `scripts/export-sam2.py`; it writes real hashes only after both ONNX files pass CPU parity and opset checks. [Reproduction and evidence](../specs/photoctl/assets/sam-export/README.md) document the isolated export environment.
