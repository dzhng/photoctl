# fixtures/

Known-good and known-bad assets, committed to git, used by the functional test suite.
Every file here has one line saying what it proves. Add a line when you add a file.

| File | Kind | Proves |
|---|---|---|
| `a7c2.ARW` | known-good | Sony ILCE-7CM2, uncompressed ARW, 7008×4672, `OffsetTimeOriginal +02:00`, embedded JPEGs at 160×120 / 1616×1080 / 7008×4672. Decode, locator, content key, timezone rule, preview tiers, identity export. |
| `a7c2-lossless-l.ARW` | known-good, CC0 | Full-resolution Sony lossless-L RAW decodes; its stored Compression=7 survives LibRaw's internal dispatch normalization. |
| `a7c2-lossy.ARW` | known-good, CC0 | Sony lossy compressed RAW (Compression=32767) preserves the same camera-space decoder contract. |
| `corrupt/a7c2-truncated.ARW` | known-bad | A genuine TIFF header and truncated first directory are skipped by public import without a crash or catalog photo. Its adjacent JSON records the exact source prefix and hash. |
| `libraries/` | historical evidence | Frozen pre-pairing catalogs document historical writer behavior; they are not supported input to the clean-start catalog model. |
| `xmp/classic.xmp` | known-good | A Classic-style sidecar exercises rating, label, flat and hierarchical keywords, and photoctl's namespaced flag. |
| `tools/drive.mjs` | generator | `fixtures:drive -- --count N --out DIR` creates deterministic tail-distinct ARW copies and matching Classic-style sidecars. |
| `tools/volume.mjs` | host generator | `fixtures:volume -- --path FILE --mount DIR` creates and attaches a macOS APFS disk image for real offline-volume checks. |

The permanent [camera reference collection](camera/README.md) adds user-provided
originals with varied scenes, compression, reduced resolution and portrait rotation.
Its adjacent manifests own exact measured dimensions; M/S mode coverage must be
established from those facts rather than assumed from file size. Compression coverage
and committed references do not substitute for real-drive acceptance.

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
their measured host in the [compression evidence](../specs/done/photoctl/assets/gates/libraw-compression.json), not treated as
portable hashes or an independent photographic-quality oracle. Decoder suites discover the committed ARWs
and consume these same manifests rather than maintaining another compression-mode inventory.

The new compressed frames come from [raw.pixls.us](https://raw.pixls.us/), whose repository rows explicitly mark them CC0;
their manifests retain source URLs, repository dates, license and SHA-256. Keeping the originals makes decoder coverage
offline and reproducible; resized/re-encoded substitutes cannot exercise the RAW codecs. SonyRawFileType=4 identifies lossless compressed RAW 2 according to [ExifTool's tag documentation](https://exiftool.org/TagNames/EXIF.html);
the 7008×4672 default crop matches [Sony's full-frame L specification](https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7cm2/specifications).
The repository's 4:3 label is not proof of the developed aspect ratio or M/S coverage; the crop is read from the file.

Historical SQL dumps remain untouched evidence of earlier writers, not a compatibility promise.
The paired-originals model uses fresh catalogs: tests seed logical photos and their independent
originals directly. Current bootstrap, relational ownership, collision promotion, metadata-only
backup and restore remain tested; upgrading these pre-cutover dumps is intentionally outside
the development contract. The graph removal tests author fresh historical revisions rather than
using an old catalog as an implicit adapter.

The `sam_probes` annotations in `a7c2.json` are authored from visible subjects, not model outputs.
Remeasurement preserves them only while the image SHA-256 is unchanged. Their area bands test coarse
selection, not edge quality; [photographic evidence](../specs/done/photoctl/assets/sam-photographic/README.md)
records that separate verdict. The shared `test/model-runtime` suite is part of both the default
Docker functional gate and the default macOS suite, in addition to their existing tests. Missing
models or an empty test selection fail visibly; the narrow `test:models` script is a diagnostic,
not a replacement for those defaults.

Docker takes an explicit `PHOTOCTL_MODELS_BASE_URL`, fetches and verifies the manifest's files during
the functional image build, and exposes that directory to the tests. The gateway fixture uses the
built application image without fetching models. Use a published release's model URL
or a reachable local HTTP server serving the pinned official files. Tag-triggered releases
prepare models before testing and pass them directly to native-runtime jobs; they do
not depend on a pre-existing public URL or repository variable. Ordinary smoke CI
does not run the full model suite. See [release ownership](../specs/done/photoctl/README.md#release).

On a host, set `PHOTOCTL_SEGMENT_MODELS_DIR` to an existing model directory. To provision from a
configured base URL, build the TypeScript packages and use the same fetch owner as Docker:

```sh
node scripts/fetch-models.mjs /path/to/models --base-url "$PHOTOCTL_MODELS_BASE_URL"
PHOTOCTL_SEGMENT_MODELS_DIR=/path/to/models bun run test:macos
```

The library's [pinned model manifest](../packages/library/src/pinned-model-manifest.ts)
owns artifact identity. Omit `--base-url` to acquire official ONNX files directly
from the pinned upstream revision. Acquisition retains the bundled noncommercial
license and attribution; hash checks establish artifact identity, not visual quality.
