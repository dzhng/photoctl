# Native coordinate provenance

LibRaw applies the recorded crop origin and size on both references. The differing
feature placement in the neutral-decoder comparison is not evidence that LibRaw
forgot those tags. CIRAW's internal sensor-to-output mapping remains unobserved;
its zero-origin output extent is not a statement about sensor crop origin.

## Observed facts

Both DSC09314 and DSC08819 have RAW SubIFD dimensions 5120×3584. Standard TIFF
DefaultCropOrigin/DefaultCropSize and Sony tags 0x74c7/0x74c8 agree:
origin `[44,30]`, size `[4608,3072]`. Orientation is 1. The TIFF JSON records retain
IFD, entry and data offsets, types, values and original file hashes.

The matching compiled LibRaw runtime reports the same progression for both files:

| Stage | Live and saved active size | Live and saved left/top margins |
| --- | --- | --- |
| Open / unpack | 4624×3080 | 0,0 |
| `adjust_to_raw_inset_crop(1)`, return value 1 | 4608×3072 | 44,30 |

Inset0 already carries `[44,30,4608,3072]` before selection. The saved sizes are
updated too: the later `raw2image_start()` restore does not undo the selected crop.
Intermediate `iwidth/iheight` remain 4624×3080 at this metadata-only stop; the
existing `raw2image_start()` recomputes them before pixel copying. This intermediate
state is not a demonstrated stride bug. No demosaicing or image rendering occurred.

CIRAW decoder 8 reports native size 4608×3072 and output extent
`[0,0,4608,3072]` for both. ImageIO reports those dimensions and orientation 1.
All neutral controls read back the requested values, including scale 1, zero
exposure/noise/sharpening controls, and disabled lens correction, gamut mapping
and highlight recovery. This excludes a nonzero/fractional extent-origin mistake
in these captures, not a hidden framework crop, scaling or coordinate policy.

The existing oracle checks dimensions, then corresponding patch means; it does not
establish pixel registration. Keep its current thresholds and tests. A future
geometry witness should compare an observed source-to-output mapping with declared
crop semantics, not assert CIRAW pixels as ground truth. No owner-specific failing
product regression has been established here, and no algorithm change is justified
by these metadata facts alone.

## Reproduction and scope

The six JSON records are the retained metadata evidence. One-off probe sources
remain outside the repository at `/private/tmp/photoctl-coordinate-metadata.NPZrRD`;
they are not product utilities or permanent test helpers.
The TIFF reader follows main/next/SubIFD/ExifIFD chains for selected basic tags; it
does not interpret proprietary MakerNote internals. The Swift script initializes
the framework and asks for lazy output extent, with no CIContext or pixel rendering.

The C++ utility links an existing release archive from the successful isolated
packed build at worktree base `8c9d1fc`:
`/private/tmp/photoctl-highlight-native/target/release/build/libraw-sys-0bf4dff17f04c951/out/libphotoctl_libraw.a`.
All LibRaw source changes since that base are empty; all 94 tracked build/header
inputs predate the archive. Headers and runtime both report 0.22.2-Release;
`sizeof(libraw_data_t)` is 381576. It uses the matching C++11/libc++/NO_JPEG/NO_LCMS
configuration, not guessed structure offsets or another installed LibRaw version.
No library or native addon was rebuilt. The scratch executable's deployment floor
is 13.3; it runs on the measured macOS26.4.1 host.

The exact build command is:

```sh
clang++ -O2 -std=c++11 -DNO_JPEG -DNO_LCMS -stdlib=libc++ -mmacosx-version-min=13.3 \
  -I /private/tmp/photoctl-highlight-native/crates/libraw-sys/vendor \
  margins.cpp /private/tmp/photoctl-highlight-native/target/release/build/libraw-sys-0bf4dff17f04c951/out/libphotoctl_libraw.a \
  -o margins
```

Each utility ran once per named original. `tiff.mjs` and `extent.swift` accept source
and JSON-output paths; `margins` accepts the source and emits JSON on stdout. The
runtime utility only calls open, unpack and inset selection. Original source hashes
are in the TIFF records and match the permanent manifests. No camera access, product
edits, new image captures or algorithm experiments occurred.

SHA-256 identities:

- Existing archive: `1d0fee415a673b5543c8c724891979f5bbdbfdcfc2109b45501aacd696231ae2`
- Scratch executable: `ee6f26998a09fa6bbbaef4658a8534c0591650b4cb59c0bd87ef2a02246825f5`
- `libraw_types.h`: `294f6d0c904d017d4b047fd30890e16dbd4a6b7665911b5aa1b99df7bde0aa20`
- `libraw.h`: `48b3048304f42266ddb5bb5068f69427c249d574f80d8423387906d44bcae27d`

These observations complement the retained neutral-decoder images; they do not
replace their finding that equal dimensions concealed displaced scene content.
