# Choices consolidation review — coverage and scope

Review metadata for the 2026-09-08 rewrite of
[`../choices.md`](../choices.md). This file is **not** a second ledger: it holds
no verdicts, no confidence ratings and no scenarios. It exists so a reviewer can
trace how 389 accumulated entries became 115
consolidated ones, and so the limits of that pass are stated rather than implied.

## Accounting

This is the integrated working ledger, not a claim of completed whole-spec acceptance.
Root has now read all consolidated entries and checked contested claims against
their current owners. Entries are ordered by their lowest stated confidence,
with stable IDs and unchanged entry contents verified during the mechanical sort.
Remaining source/requirement reconciliation still governs final acceptance.
The five domain source audits and an independent identity/export
check remain scoped evidence, not exhaustive source verification.

| | Count |
|---|---|
| Entries in the previous ledger (`###` and section-level entries) | 388 |
| Headingless entries in the previous ledger | 1 (old line 118) |
| **Total previous entries** | **389** |
| Entries in the consolidated ledger | 115 |
| — needs-user (`U2`–`U26`, excluding U7/U21/U23/U25) | 21 |
| — resolved by the user on 2026-09-08 and moved to sound (U1 → S94; the pairing card layout entry → S95) | 2 |
| — unsound current choices | 0 |
| — sound (`S1`–`S95`) | 95 |
| Previous entries merged into a consolidated entry | 388 |
| Previous entries carried as discretion only (no product surface) | 1 |
| Previous entries dropped without disposition | 0 |

The consolidated count sits above the 60–90 entries the pass aimed for. Further
merging was available only by discarding distinct material choices or their
walked scenarios — for example by collapsing pairing, camera-JPEG caching and
sidecar aliasing into one paragraph, or by folding the native-memory,
native-diagnostic and native-link entries together. Preserving every decision
was treated as the higher obligation, so the overshoot is deliberate and is
recorded here rather than hidden.

## Two consolidated entries have no predecessor

Both are newly banked, not merged:

- **S2 — two command seams classify domain errors by message text.** Surfaced by
  the returned cross-domain audit. Root verified both mappings are correct today,
  including the exact-match branch for a non-subject `fill --move` target, so it
  is banked as sound with the message coupling recorded as a maintenance
  weakness — not as the wrong-exit-class defect the draft alleged.
- **S79 — the release workflow builds four platform packages and verifies one.**
  The Mac-only verification policy was applied to the tag workflow on 2026-09-08;
  the previous ledger recorded the packaging choices but never the resulting
  verification scope.

## Integrating corrections

Root checked the initialization, daemon-startup, restore, settings and provider
owners against the draft. The corrections below change documentation only:

- Initialization closes its bootstrap handle; daemon startup acquires and transfers
  its own lock descriptor. Continuous lock ownership applies across spawning.
- Restore stages individual hard links before the directory swap; building that
  staged tree is not itself one atomic operation.
- Public setting writes are strict, not tolerant of unknown fields. Response
  parsing is a separate contract.
- Provider normalization preserves the returned raster and does not resize it to
  the request. Display-byte expansion belongs to working-image conversion.
- Unsupported references with an explicit prompt can warn and continue without
  the reference. Reference-only or explicit reference-strength requests refuse
  before payment instead.
- Full-frame input, reference-strength direction and current rendering approval
  are preserved as S90–S92, not reopened as unanswered preferences. White-balance
  sampling remains the owning slice's provisional policy, not a fresh blocker.
- Automatic fine-edge quality remains unmet. Manual correction does not authorize
  changing its acceptance requirement or prescribe an unbuilt refiner architecture.
- Already-corrected X1–X5 history is mapped to surviving current decisions rather
  than retained as five supposedly unsound current choices.
- S5 includes the shared-cache setup correction from `3d9b8c1`: shared destination
  errors precede admission, unsupported-only scans need no cache, and individual
  conflicts still retain paths and readable reasons rather than typed error data.
- Canonical artifact publication uses hard-link installation, accepts identical
  existing bytes and repairs corrupt owned files. User-selected delivery paths
  instead use native no-replace rename. Those owners must not be conflated.
- Lazy graph initialization also applies to ordinary fresh imports; it is not
  an old-schema migration promise. Retained-frame inference lives in projection,
  while availability checks—not reachability—mark lost artifacts unavailable.
- Valid returned images survive later policy rejection, but invalid responses or
  failed persistence cannot be claimed retained. Structured provenance excludes
  transport credentials, not arbitrary sensitive text a user puts in a prompt.
- Execution identifiers distinguish deterministic SHA-256 identity from random
  256-bit IDs for nondeterministic attempts; identical hexadecimal shape is not
  identical derivation.
- Delivery receives evaluated RGB16 pixels and encodes them, including upright
  camera JPEGs. The old resolved-source/direct-copy export description was stale.
- Optional authoring checkpoints do not promise development-catalog migrations.
  Removed headless verification is not retained as an unanswered capability gate.
- Shared geometric resampling and asynchronous large native jobs do not imply
  every model sampler is shared or every small preview operation is asynchronous.
- Tuning operating defaults does not require new camera access; public publication
  is unverified, without claiming knowledge of every historical tag operation.
  Delegated tuning is S93, not a fresh user-only approval item.

The coverage check matches all 394 previous headings plus the headingless entry
to 395 map rows, with no missing/mismatched headings or nonexistent target IDs.
All 115 current entries have the seven required fields. These checks prove
structural accounting, not semantic completeness or source correctness.

The integrating shape pass reduced the build-order ledger to one current choice
owner and moved review accounting here. Diff review corrected the contested
contracts listed above; documentation review removed three stale platform-gate
instructions from the owning slices and checked the root-to-ledger link chain.
No product behavior or acceptance threshold changed in this documentation pass.

## Coverage map — every previous heading to its disposition

`GROUP` marks one of the previous ledger's six verdict-section headings
(`## Unsound`, `## Needs-user`, `## Sound`, `## Superseded`, `## Sound`,
`## Needs user`), which carried no entry content. `DISCRETION` marks an entry
compressed to the discretion note below. Line numbers refer to the previous
`specs/photoctl/choices.md` at source `66a30ef`.

| Old line | Previous heading | → |
|---|---|---|
| 3 | Local selection correction and redo — sound | U1 |
| 20 | Redo navigation versus retained history | S47 |
| 36 | Refinement preserves the selection's coordinate frame | U1 |
| 54 | Verification fixtures follow the behavior, not incidental scheduling — sound | S81 |
| 69 | Reduced-RGB decode correction — sound | S66 |
| 85 | Functional container — Enforce filesystem permissions during tests | S81 |
| 103 | Verification — Separate full-RAW journey hang guards from speed acceptance | S81 |
| 118 | *(headingless entry — a second `When/choice/gap` block inside the section above)* Demosaic dispatch chosen by the decoded sensor layout | S66 |
| 133 | Unsound | GROUP |
| 135 | Slice 13a generate — Speculative reference transport superseded | S84 |
| 159 | Needs-user | GROUP |
| 161 | Slice 12f plan — Removing borders preserves a later exterior crop | U3 |
| 179 | Slice 12f plan — Missing inner borders leave warned black canvas | U3 |
| 196 | Slice 12f plan — Expand the visible picture symmetrically | U13 |
| 216 | Canvas ancestry — Capture the ordered input projection when a border is authored | S60 |
| 240 | Shared mask projection — preserve both authored footprints | S57 |
| 260 | Canvas restrictions — Aspect edits start from the stable authored canvas | S60 |
| 284 | Canvas core — Separate historical order from support that remains active | S60 |
| 299 | Canvas core — A placed border retains its full intrinsic raster | S60 |
| 316 | Canvas core — Clip admissibility after ordered sampling | S60 |
| 333 | Canvas core — Preserve exterior intent and distinguish a new request from support removal | S60 |
| 348 | Canvas core — New raster limits preserve source-sized operations | U12 |
| 363 | Canvas core — Snap only roundoff-scale integer boundaries before outward raster rounding | S60 |
| 379 | Canvas core — Uncovered warnings describe structural support, not painted color | U3 |
| 395 | Slice 12f plan — Authored crop boundaries belong to enabled borders, not permanent source edits | U14 |
| 416 | Slice 12f plan — Transform the border, not the whole photograph | U15 |
| 431 | Sound | GROUP |
| 433 | Paid image responses — Retain original encoded bytes beside working pixels | S34 |
| 450 | Standalone generation — A reference without text requests a variation | S84 |
| 470 | Native decoding — Request scene pixels without a second full-image snapshot | S71 |
| 487 | Native decoding — Calibration belongs only to camera-channel pixels | S66 |
| 502 | Native decoding — Do not count predicted worker allocations as owned memory | S71 |
| 518 | Camera references — Keep real JPEG companions and separate geometry from color evidence | S83 |
| 538 | Native compositing — Reuse owned inputs without changing mask meaning | S71 |
| 552 | Supported projection — Keep one RGB worker behind the shared frame planner | S71 |
| 571 | Supported projection — Share the visible-frame predicate with mask clipping | S71 |
| 588 | Supported projection — Allocate and account two reusable stage buffers | S71 |
| 608 | Slice 11 — Serial SAM inference keeps one allocation thread | S71 |
| 628 | Paid response inspection — Keep metadata listing separate from file verification | S34 |
| 648 | SAM preparation — Release photographic pixels before waiting for inference | S71 |
| 669 | Editable develop input — Preserve the whole purchased RGB branch | S32 |
| 686 | Paid response retention — Record attempts before deciding whether their images can be used | S34 |
| 705 | Paid response artifacts — Classify bytes independently of how an execution uses them | S34 |
| 724 | Slice 12e2 — Reference intent has one adapter and artifact owner | S84 |
| 746 | Slice 12f plan — Track whether a crop is active, not only its numeric value | S87 |
| 762 | Upscaler reports — Unequal rasters have no direct pixel-drift measurement | S40 |
| 776 | Slice 12 — Regeneration revisits original selection intent under current visibility | S31 |
| 793 | Slice 12 — Visibility clips sample centers and reports what was excluded | S30 |
| 808 | Slice 12 — Provider context uses bounded native affine sampling with protected black padding | S30 |
| 824 | Slice 12f plan — Frame ownership precedes canvas growth | S88 |
| 842 | Slice 12f1 — Recover old execution coordinates only when retained ancestry agrees | S44 |
| 861 | Slice 12f1 — Save coordinate meaning with each execution, not with shared pixel bytes | S43 |
| 880 | Slice 12f1 — Treat the best declared source tier as a reusable preview ceiling | S86 |
| 901 | Renderer corrections select new derived caches without deleting old work | S43 |
| 918 | Mask inspection names its cached context instead of inventing last-shown history | S41 |
| 934 | Gold reports preserve delivered bytes and require explicit source classification | S41 |
| 950 | Slice 12 — Mask-polarity probes capture evidence without enabling a provider | S28 |
| 968 | Slice 14 — Source and installed CLI use the same editing journey | S78 |
| 984 | Slice 12e1 — Selection intent and fill coverage are different graph values | S31 |
| 1002 | Slice 12e1 — Hard fitting thresholds coverage while free fitting preserves it | U16 |
| 1022 | Slice 14 — One CLI tarball contains the private runtime modules | S78 |
| 1039 | Slice 14 — Shipping uses optimized binaries and one version owner | S78 |
| 1055 | Slice 11 — Cropped prompts keep their meaning rather than moving to a visible edge | S70 |
| 1070 | Slice 11 — Encoder reuse follows pixels, not metadata revisions | S70 |
| 1083 | Slice 12e2 — Provider sampling is separate from the final fill crop | S30 |
| 1104 | Slice 13a generate — Standalone paid pixels are a source-less generation recipe | S33 |
| 1120 | Slice 13a generate — Catalog creation and the first graph revision share the import transaction | S33 |
| 1140 | Slice 13a generate — External 8-bit samples are expanded before canonical color conversion | S29 |
| 1154 | Slice 12d3 — Vacancy workflow state comes from content lineage, not role | S59 |
| 1169 | Slice 12d2 — The keyless agent journey separates state continuity from model aesthetics | S41 |
| 1185 | Slice 12a — The generation execution and active graph revision commit together | S33 |
| 1199 | Slice 12a — A generation recipe pins the execution that supplied its pixels | S33 |
| 1212 | Slice 12a — Generation preserves crop sampling; resample owns base placement | S32 |
| 1229 | Slice 08c3 — Normalized controls use OpenColorIO's scene-linear curve domain | S53 |
| 1245 | Slice 08c3 — Levels preserve extended scene-linear samples | S53 |
| 1259 | Slice 08c1b — Global develop has one native owner and a fixed scene-linear order | S53 |
| 1272 | Slice 08c1b — White balance uses a bounded Planckian/Bradford model | S53 |
| 1283 | Slice 08c1b — The linear probe publishes the actual graph artifact without replacement | S45 |
| 1296 | Slice 08c1b review — Native global develop owns one asynchronous worker buffer | S71 |
| 1312 | Slice 08c1b review — No-replace publication is one native atomic install | S45 |
| 1326 | Slice 08c1b — Workbench A/B verifies dimensions, not provenance | S41 |
| 1337 | Slice 08b integration — Develop batches reuse the shared failure owner and classify revision races as contention | S6 |
| 1353 | Slice 08b — Copy selects the mutation base before the other develop operations | S54 |
| 1369 | Slice 08b — Preset provenance is stored in the node recipe but excluded from the develop hash | S54 |
| 1385 | Slice 08b — Saved develop presets contain resolved settings and replace atomically by name | S54 |
| 1399 | Slice 08b — Structured develop values use one normalized JSON vocabulary | S54 |
| 1412 | Slice 05/08a2 integration — Source decode failures cross the evaluator as a distinct error | S13 |
| 1428 | Slice 05 review — TIFF delivery metadata is embedded in-process | S12 |
| 1445 | Slice 05 — Delivery publication wins safety over perfectly atomic history | S12 |
| 1462 | Slice 05 — Library presets shadow package presets and CLI metadata merges by field | S12 |
| 1476 | Slice 04 — Sampled identity keeps a narrow relocation inference and an mtime replacement boundary | S3 |
| 1493 | Slice 04 — Copy mode has one catalog-local volume identity | S4 |
| 1506 | Slice 04 — Streams retain only bounded pages and honor consumer backpressure | S5 |
| 1519 | Slice 04 — Disk removal stages reversible receipts before catalog commit | S11 |
| 1531 | Slice 03b — Restore recovery trusts durable topology, not the last journal phase | S18 |
| 1540 | Slice 03b — Successful restore returns only durable public facts | S18 |
| 1549 | Slice 03b — Migration history must be the exact known prefix | S18 |
| 1558 | Slice 03b — pgDump cleanup is part of the narrow backup capability | S18 |
| 1567 | Slice 03b — Backup durability precedes retention | S18 |
| 1576 | Slice 03b — Restore fault hooks are test-only lifecycle seams | S18 |
| 1585 | Slice 02b — Human output neutralizes terminal controls and row delimiters | S22 |
| 1600 | Slice 02b — Failures without a supplied message get a label derived from their code | S22 |
| 1615 | Slice 03a — Preview provenance is cryptographically bound to the JPEG bytes | S48 |
| 1632 | Slice 03a — Prune claims each path before deleting and lets a concurrent touch win | S19 |
| 1649 | Slice 03a — `cache prune` reports budget movement and accepts zero as an explicit purge target | S19 |
| 1664 | Slice 03a — Cache-index paths are relative to the active per-library cache root | S19 |
| 1682 | Slice 02 — Daemon startup transfers the already-held kernel lock | S16 |
| 1694 | Slice 02 — Initialization is the sole in-process bootstrap command | S16 |
| 1706 | Slice 02 — Daemon transport has a bounded length-prefixed frame | S17 |
| 1718 | Slice 02 integration — Initialization success survives an optional daemon-start failure | S16 |
| 1732 | Slice 02 integration — Daemon control reports observed state and secures local IPC | S17 |
| 1752 | Spec maintenance — Preview cache safety lands before new render producers | S88 |
| 1765 | Spec maintenance — Sampled identity collisions promote only the colliding bucket | S3 |
| 1777 | Rendered previews are lazy, versioned views of committed edit state | S48 |
| 1802 | Preview clipping intersects pixel edges instead of moving the requested rectangle | S49 |
| 1818 | Lossless tiled masters and progressive UI delivery are later optimizations | S50 |
| 1831 | Slice 01b importer — EXIF parsing returns source dimensions and leaves orientation geometry to render | S51 |
| 1848 | Slice 01b importer — Missing descriptive EXIF is nullable, but missing dimensions refuse import | S51 |
| 1864 | Slice 01b — Pixel orientation and coordinate orientation share one transform table | S49 |
| 1883 | Slice 01b — Preview-source `Image16` is full-range, display-referred sRGB in an interleaved typed array | S51 |
| 1902 | Slice 01b — Export receives resolved sources and leaves destination planning to its caller | S51 |
| 1921 | Slice 01b — Photo rows represent absent metadata without inventing values | S51 |
| 1937 | Slice 01b — One open file produces identity and locator stat facts | S3 |
| 1955 | Slice 01a — A successful `doctor` reports no foreign lock holder | S16 |
| 1970 | Slice 01a — A cache override selects a base directory, not one shared cache | S19 |
| 1984 | Slice 01a — PGlite durability is configured before Postgres starts | S16 |
| 2000 | Slice 01a — The external lockfile is backed by the operating system's advisory lock | S16 |
| 2016 | Slice 01a — Command options are parsed as a closed set | S22 |
| 2029 | Slice 00 — The fixture tool discovers previews through both TIFF pointers and JPEG validation | S82 |
| 2044 | Slice 00 — Workspace packages compile as NodeNext ECMAScript modules | S78 |
| 2057 | Slice 01b review — Import returns the IDs it created or recognized | S5 |
| 2072 | Slice 01b review — A batch with no admitted image has no invented volume | S5 |
| 2086 | Slice 01b review — A matching content key, not modification time, proves source identity | S3 |
| 2102 | Slice 01b review — Whole-file sources are identified by the content probe registry, not stored as embedded previews | S52 |
| 2119 | Slice 01b review — Cache repair validates bytes and repairs the index independently | S7 |
| 2135 | Slice 01b review — Batch failure codes are independent of item order | S6 |
| 2148 | Slice 01b review — Source I/O failures keep different retry semantics from malformed bytes | S5 |
| 2164 | Slice 01b review — The envelope workbench is static and self-contained | DISCRETION |
| 2178 | Slice 07a — Swift sends raw RGB floats through a validated temporary file | S67 |
| 2197 | Slice 07a — Helper discovery never compiles Swift at command time | S67 |
| 2214 | Slice 07a — An unrun headless gate is represented as unknown | S67 |
| 2231 | Slice 07a — Decoder fallback has its own warning code | S67 |
| 2247 | Slice 07a — Linear float output clamps to the representable 16-bit TIFF range | S67 |
| 2264 | Slice 07b — Camera samples are black-subtracted counts, not display-ready colors | S66 |
| 2282 | Slice 07b — Native decode runs off the JavaScript event loop while LibRaw remains thread-safe | S66 |
| 2299 | Slice 07b — LibRaw uses its nominal inset crop before orientation | S66 |
| 2315 | Slice 07b — Fractional decoder scales use bilinear pixel-center sampling in Rust | S66 |
| 2331 | Slice 07b — Explicit camera TIFFs normalize measured levels into real 16-bit samples | S67 |
| 2347 | Slice 07b — Native availability is lazy, but native tests build the host addon first | S81 |
| 2364 | Slice 07b — Probe answers format capability without reading the whole pixel payload | S66 |
| 2381 | Slice 07b — Recursive source discovery excludes LibRaw's alternate placeholder translation units | S89 |
| 2397 | Slice 07b integration — Git preserves vendored LibRaw whitespace verbatim | S76 |
| 2411 | Slice 03b integration — Direct commands defer non-daemon contention to the library lock | S16 |
| 2428 | Slice 07c integration — macOS signs the packaged native addon after copying it | S74 |
| 2443 | Slice 07c — Full-frame color transforms run off the daemon event loop | S71 |
| 2461 | Slice 07c — A neutral CIRAW oracle zeros per-file presentation defaults | S67 |
| 2477 | Slice 07c — The embedded JPEG is visual context, not a neutral RAW measurement | S67 |
| 2492 | Slice 07c — The oracle measures the public linear-TIFF boundary | S67 |
| 2507 | Pre-slice 08 — One immutable image DAG replaces flat render state and private layer pipelines | S42 |
| 2525 | Slice 08a1 architecture audit — Logical edit identity is separate from pixel execution identity | S43 |
| 2545 | Slice 08a1 implementation — Revision batches use local node keys and must be root-complete | S46 |
| 2560 | Slice 08a1 implementation — Unowned future node parameters start strict and minimal | S46 |
| 2575 | Superseded | GROUP |
| 2577 | Upscaler spike — Per-case reuse duplicated paid requests | S40 |
| 2592 | Slice 08a2 implementation — Display RGB16 as the canonical graph artifact was unsound | S45 |
| 2609 | Sound | GROUP |
| 2611 | Slice 08d2 — NLM uses bounded row blocks instead of allocating a denoised frame | S53 |
| 2630 | Slice 08d2 — Luminance NLM precedes chroma NLM in one fixed native order | S53 |
| 2648 | Slice 08d1 — Spatial develop extends the existing native worker with dimensions | S53 |
| 2664 | Slice 08c1a — Canonical graph artifacts preserve exact scene-linear working pixels | S45 |
| 2679 | Slice 08c1a — Graph consumers share one ordered source ladder | S45 |
| 2691 | Slice 08a2 implementation — Existing photos acquire their initial graph on first graph-aware use | S46 |
| 2704 | Slice 08a2 implementation — Revision-bound cursors finish the snapshot they started | S46 |
| 2716 | Slice 08a2 implementation — Restore preserves file trees by staging hard links | S18 |
| 2730 | Pre-slice 12 — Generated pixels optionally match destination density through a generative node | S32 |
| 2748 | Pre-slice 09 — Upscaling is an explicit external adapter with balanced guarded semantics | S27 |
| 2765 | Pre-slice 12 — Partial generative success remains useful and refresh follows current lineage | S35 |
| 2782 | Pre-slice 08 — PGlite backup remains metadata-only and restore preserves canonical artifacts | S18 |
| 2795 | Slice 09a — Gateway rate limiting has a short bounded retry window | S1 |
| 2813 | Slice 09a — Provider settings use purpose-scoped rows and explicit per-upscaler consent | S26 |
| 2827 | Slice 09a — External execution details extend the existing DAG execution record | S33 |
| 2842 | Slice 09a — Provider geometry normalizes once at the adapter boundary | S29 |
| 2857 | Slice 06 — XMP writes target one verified online original locator | S14 |
| 2875 | Slice 06 — Sidecars publish atomically before their catalog observation is recorded | S14 |
| 2903 | Slice 06 — Keyword writes flatten the catalog's tags and refuse conflicting standard prefixes | S15 |
| 2922 | Slice 06 — Filesystem shape failures use the existing per-item data-error channel | S15 |
| 2938 | Slice 06 — Doctor reports XMP divergence as a grouped count and one soft warning | S15 |
| 2954 | Slice 09b — G5 changes one high-entropy wide value per cycle | S89 |
| 2976 | Slice 09b — The embedding smoke records one aggregated-vector contract, not merely HTTP success | S40 |
| 2997 | Slice 09b — Live probes require purpose-specific invocation credentials | S40 |
| 3020 | Slice 09b review — Pixel drift is normalized telemetry, not the visual verdict | S40 |
| 3036 | Slice 09c — Normalized catalog rows feed one generated full-text index | S21 |
| 3054 | Slice 09c — Keyless catalog search uses PostgreSQL's English text configuration | S21 |
| 3069 | Slice 09c — Background batches yield the daemon command lane, not its lifetime kernel lock | S20 |
| 3089 | Slice 09c review — Foreground dispatch waits for worker database quiescence | S20 |
| 3103 | Slice 09c review — Provider errors end before catalog persistence begins | S20 |
| 3116 | Slice 09c review — Mixed-model vector ranking is exact within a materialized model set | S21 |
| 3129 | Slice 09c — The provisional multimodal dialect stays one photo per provider request | S20 |
| 3147 | Slice 09c — `embed --all` is an idempotent backfill; named IDs request refresh | S20 |
| 3161 | Slice 09c review — Slow foreground provider calls send activity frames | S20 |
| 3176 | Slice 09c review — Whole-library output keeps totals and only the first 100 failures | S20 |
| 3188 | Slice 09c review — Explicit embed keeps per-item rows within a fixed request budget | S20 |
| 3203 | Slice 09c review — A configuration rejection pauses automatic embedding until context refresh | S20 |
| 3217 | Slice 09c review — Detached worker failures are contained at the daemon boundary | S20 |
| 3229 | Slice 09c review — Provider failure drops only the optional vector search arm | S21 |
| 3242 | Slice 09c — Each retrieval arm contributes at most 200 ranked candidates | S21 |
| 3256 | Slice 09c — Search labels each hit with one deterministic catalog filename | S21 |
| 3268 | Slice 08c2 — Masked controls extend the one native grade in tonal order | S53 |
| 3280 | Slice 08c2 — Skin protection classifies hue after converting working primaries | S53 |
| 3291 | Slice 10a — Graph-only revisions inherit the complete layer snapshot | S58 |
| 3307 | Slice 10a — Vacancy is the only role that may point at another layer | S58 |
| 3320 | Slice 10a — Permanent masks are zero-input artifact pins | S57 |
| 3335 | Slice 10a — UUID layer identities are allocated only inside the revision transaction | S58 |
| 3348 | Slice 10a — Delta recipes reuse the develop dictionary over one RGB input | S58 |
| 3362 | Slice 10a — Relative transforms pre-multiply the current base-space matrix | S58 |
| 3376 | Slice 10a — Opacity snapshots preserve recipe-number precision | S58 |
| 3388 | Slice 10b1 — Resampling maps pixel centers and widens Lanczos support when reducing | S56 |
| 3408 | Slice 10b1 — Native resampling preserves caller sample depth and bounds full-raster admission | S56 |
| 3429 | Slice 10b3 — Layer compatibility is reconstructed from immutable graph lineage | S58 |
| 3447 | Slice 10b3 — Delta planning refuses transitions that cannot compose exactly | S58 |
| 3466 | Slice 10b2 — Canonical masks use a profile-free Float32 TIFF contract distinct from RGB | S57 |
| 3485 | Slice 10b2 — Mask transforms clamp filtered coverage and composition skips zero alpha | S57 |
| 3498 | Slice 10b2 — A corrupt permanent mask pin is made unavailable on its first evaluator read | S57 |
| 3510 | Slice 08d3 — Geometry projects base-space requests through one affine owner | S55 |
| 3534 | Slice 08d3 — Invalid crops fail before immutable state commits | S55 |
| 3548 | Slice 08d4 — A present B&W dictionary activates monochrome mode | S53 |
| 3565 | Slice 10c1 — Manual masks use pixel-center coverage and clip at the oriented base frame | S57 |
| 3583 | Slice 10c1 — A manual subject stays lazy by referencing the immutable base branch | S58 |
| 3598 | Slice 10c1 — Layer transforms replace geometry beneath retained develop deltas | S58 |
| 3615 | Slice 10c1 — Numeric reorder positions are one-based and z increases toward the front | S58 |
| 3628 | Slice 10c1 — Normalized transform displacements are signed image fractions | S58 |
| 3644 | Slice 10c2 — Vacancy pixels have their own deterministic RGB recipe | S59 |
| 3657 | Slice 10c2 — Repeated moves preserve one original vacancy identity | S59 |
| 3674 | Slice 10c2 — Vacancy content never receives develop compensation or stale state | S59 |
| 3688 | Needs user | GROUP |
| 3690 | Slice 10c2 — The provisional vacancy color is full scene-linear Rec.2020 magenta | U4 |
| 3703 | Slice 10b2 — Morphology uses a square footprint and feather uses three bounded box passes | U17 |
| 3717 | Slice 10b1 — Lanczos transforms reject kernels above 4,096 source taps per output sample | U18 |
| 3732 | Slice 09a — The fake upscaler is the provisional release default | U2 |
| 3747 | Slice 08a2 — Graph inspection uses provisional response bounds | U5 |
| 3760 | Slice 05 — Collision `skip` is a successful no-write result with requested-state identity | U6 |
| 3776 | Slice 04 — Import and list use fixed bounded-work windows | S93 |
| 3789 | Slice 02 integration — CLI tags trim boundaries but preserve case and Unicode | U9 |
| 3802 | Slice 01b — Rendered JPEG fallback uses quality 88 | S93 |
| 3816 | Slice 01b — An ambiguous photo prefix uses `not_found` with an explicit reason | U8 |
| 3832 | Slice 01a — The provisional daemon idle timeout is fifteen minutes | S93 |
| 3846 | Slice 10c1 — Automatic layer names use stack-local English labels | U10 |
| 3862 | Slice 08 — Selective color interpolates named bands in working-space hue | S53 |
| 3873 | Slice 08 — Selective color stays in the finishing sequence before vignette | S53 |
| 3886 | Slice 11a — An incomplete model release is represented, not counterfeited | U26 |
| 3900 | Slice 11a — SAM uses a centered rounded letterbox and strict-positive mask threshold | U20 |
| 3915 | Slice 11b — One text command commits all matched masks in one revision | S70 |
| 3927 | Slice 11b — Grounding fan-out is provisionally capped at 100 instances | U19 |
| 3940 | Slice 11b — Dry runs and committed segmentation share one instance response | S70 |
| 3953 | Slice 12b — Cached density artifacts are bound to one generation and selected deterministically | S32 |
| 3969 | Slice 12b — A provider with no valid output falls back to the usable generation | S32 |
| 3983 | Slice 12b — Fractional advertised scales must still land on whole pixels | S32 |
| 3997 | Slice 12c1 — Enablement records intent separately from whether execution can proceed | S26 |
| 4013 | Slice 12c2 — Retry recognizes one canonical fill branch, not arbitrary ancestry | S35 |
| 4028 | Slice 12c2 — `executed` describes the active graph path; execution records disclose reuse | S35 |
| 4040 | Slice 12d — Affine resample matrices map source edges forward into the base canvas | S56 |
| 4056 | Slice 12d preview foundation — Reusing a valid preview artifact repairs its cache accounting | S48 |
| 4072 | Slice 12d provider runtime — Runtime registry instances share one provider-owned roster | S26 |
| 4089 | Slice 12d1 — A failed explicit upscale refresh preserves the active upscale | S35 |
| 4107 | Slice 12d1 review — Generation refresh refuses pre-fill transform geometry until affine rebasing exists | S35 |
| 4123 | Slice 12d provider runtime — The fake image path is authorized by a safe local profile, not a gateway claim | S28 |
| 4141 | Slice 12d workbench fill — Inspection may materialize deterministic nodes only from cached lineage | S41 |
| 4160 | Slice 12d workbench fill — Cyan marks the canonical mask edge without obscuring its texture | U11 |
| 4174 | Slice 12d workbench fill — Refuse transformed branches until crop coordinates can follow them | S41 |
| 4186 | Slice 12d2 — Generation recipes retain later density intent | S32 |
| 4203 | Slice 12d2 — One affine rebuild owns generated placement and mask alignment | S35 |
| 4217 | Slice 12d2 — Failed density growth preserves the best valid external artifact | S32 |
| 4230 | Slice 13a — Reimagine and fill share one external generation-and-density owner | S36 |
| 4242 | Slice 13a — Strength is provider guidance plus exact whole-frame blend coverage | S36 |
| 4255 | Slice 13a — Reimagine uses the edit model and non-authoritative progress | S36 |
| 4270 | Slice 13a — Require a dimension-retaining current base before provider work | S85 |
| 4283 | Slice 13d — Public repair extent and native reconstruction neighborhood remain separate | S63 |
| 4300 | Slice 13b — Preview statistics have one explicit transfer-space and quantile convention | S39 |
| 4315 | Slice 13b — The C4 proposal contract owns narrower ranges before ordinary develop mutation | S39 |
| 4327 | Slice 13b — Undo is a versioned active-revision transition, including no-op proposals | S39 |
| 4346 | Slice 13b — Model input reuses the current preview owner and records available execution identity | S39 |
| 4360 | Slice 13a relight — Lighting intensity is both C3 guidance and exact blend coverage | S36 |
| 4376 | Slice 13a relight — Public lighting controls use physical domains and a shared response shape | S36 |
| 4391 | Slice 13c — The vector document is mirrored by one final deterministic graph node | S64 |
| 4410 | Slice 13c — Base-space vectors are projected as premultiplied color plus coverage | S64 |
| 4424 | Slice 13c — Rendering is host-independent and bounded | S64 |
| 4437 | Slice 13c — Markup scales with the source tier before develop projection | S64 |
| 4453 | Upscaler spike — Controlled experiments belong to an explicit runner manifest | S40 |
| 4465 | Upscaler spike — Inspection context and provider facts are not inferred acceptance | S40 |
| 4479 | Upscaler spike — Evidence belongs to the current run, including failures | S40 |
| 4492 | Upscaler spike — Keep full detail files, but bound the overview and reuse identical requests | S40 |
| 4506 | Upscaler spike — Request identity owns paid work across inspection cases | S40 |
| 4519 | Upscaler spike — Failure stops spending; preflight is not an input snapshot | S40 |
| 4532 | Upscaler spike — Detail bounds cover intersecting mapped pixels | S40 |
| 4544 | Upscaler spike — Manifest control ranges are a runner restriction, not a provider guarantee | S40 |
| 4556 | Photographic output — Resolve editing intent inside the existing revision transaction | S60 |
| 4575 | SAM export — Rank logits, preserve reported probabilities, and separate export acceptance | S70 |
| 4595 | Photographic probes — Image annotations survive only identical source bytes | S82 |
| 4612 | Geometry authoring — New identities capture the checkpoint unless the caller preserves an older one | S60 |
| 4632 | Geometry metadata — Existing revisions adopt the extra root only when it is authored | S60 |
| 4649 | Pointwise color — Reuse private storage without changing caller ownership | S71 |
| 4667 | Canvas coverage — Ignore only roundoff-scale total area after viewport normalization | S60 |
| 4687 | Native color tasks — Report private snapshots to Node without changing collection policy | S71 |
| 4718 | Native resampling tasks — Charge input until it is freed, independently of output | S71 |
| 4736 | Real-model gate — Rebuild the requested source, with provisioning kept explicit | S77 |
| 4754 | Docker toolchain — Match the pinned inference archive's C++ runtime | S75 |
| 4772 | Runtime initialization — Prove timing separately from artifact equivalence | S76 |
| 4789 | Daemon recovery — Never replay an operation whose outcome is unknown | S17 |
| 4809 | RAW compression — Preserve the file's tag separately from decoder routing | S66 |
| 4825 | Fixture annotations — Bind authored facts to immutable image bytes | S82 |
| 4842 | Native diagnostics — Bounded process capture, transported by existing operations | S72 |
| 4865 | Native diagnostics — Omit the pinned wrapper's unreliable category | S72 |
| 4877 | Default overview — Qualify by the image graph, not an empty edit summary | S48 |
| 4896 | Default overview — Keep existing source validation and preview publication owners | S48 |
| 4915 | Public undo — Keep the first image inside the atomic revision owner | S47 |
| 4933 | Public undo — Document edits, with the existing conflict boundary | S47 |
| 4951 | Canvas sampling — Local supply satisfies demand; it does not create global demand | S61 |
| 4972 | Canvas sampling — Preserve physical frames while changing the integer sampling grid | S61 |
| 4991 | Canvas provenance — Output sampling does not certify recovered original detail | S61 |
| 5008 | Canvas contribution — Reuse final projected mask coverage to admit local supply | S61 |
| 5030 | Canvas cache — Check original sampling when local pixels satisfy output dimensions | S61 |
| 5051 | Corrupt RAW fixture — Truncate before any usable preview, preserving genuine container structure | S82 |
| 5064 | Historical schema fixtures — Recreate old writer state, not a current database with an old label | S82 |
| 5082 | Historical schema fixtures — Prove metadata preservation without claiming pixel recovery | S82 |
| 5101 | Filter command — Share the develop mutation and its result envelope | S54 |
| 5115 | Show path — Keep IDs stable and do not guess missing-path identity | S24 |
| 5133 | Show path — Select by the existing locator, not image content or implicit import | S24 |
| 5150 | Show path — Separate path identity from source-pixel availability | S24 |
| 5165 | SAM canvas — Source exclusion does not invent a second selection rule | S70 |
| 5180 | SAM grounding — Keep its existing JPEG boundary separate from geometric correctness | S70 |
| 5194 | SAM progress — A disconnected listener is not a cancellation request | S70 |
| 5209 | SAM snapshot — Reject a mask prepared before another shared-handle edit | S70 |
| 5229 | Local horizon — Analyze visible contrast in the existing native worker runtime | S55 |
| 5254 | Full-source performance — Optimize image work inside the normal development build | S78 |
| 5272 | Native runtime acquisition — Cargo owns a target-local source build | S73 |
| 5292 | Native runtime acquisition — Record the actual toolchain, do not imply binary equivalence | S76 |
| 5308 | Native runtime acquisition — Damaged cache entries fail explicitly | S73 |
| 5323 | Native image packaging — The image addon, not a Rust SDK, owns final linkage | S74 |
| 5344 | Native image packaging — One shared macOS deployment floor | S74 |
| 5361 | Outpaint refresh — Keep authored predecessors, use their current edits | U22 |
| 5379 | Outpaint coverage — One exterior owner at independent native density | S62 |
| 5393 | Outpaint refresh preparation — Retain immutable drafts without activating them | S62 |
| 5410 | Outpaint retry — Restore authored density without another generation | S62 |
| 5428 | Outpaint refreshed border — Do not retain a second historical interior | S62 |
| 5442 | Outpaint core — Share paid preparation without early document activation | S62 |
| 5462 | Slice 08g — A neutral click reads the editable base before user grading | U24 |
| 5479 | Slice 08g — Limited correction stays useful and exposes what remains colored | S65 |
| 5494 | Slice 08g — Offline sampling reports available pixel centers instead of inventing detail | S65 |
| 5507 | Paired import — Failed groups remain visible without starving their neighbors | S5 |
| 5522 | Paired import — An established pair is not a collection of alternate JPEGs | S8 |
| 5537 | Paired inspection — Online means the primary is available | S8 |
| 5552 | Camera JPEG — Reuse the renderer's cache invalidation owner | S9 |
| 5568 | Camera JPEG — Offline derived views do not expand this checkpoint's source contract | S9 |
| 5583 | Paired sidecars — Treat case-only target differences as possible aliases | S10 |
| 5597 | Companion selection — Excluded originals cannot create selection ambiguity | S8 |
| 5610 | Pair identity — Capture facts are a contradiction check, not a matching heuristic | S8 |
| 5625 | Culling performance — Separate result membership from current availability | S25 |
| 5645 | Offline export — A retained render must prove both current intent and source quality | S13 |
| 5666 | Offline export — Equal-quality automatic decoder candidates use a stable tie-break | S13 |
| 5681 | Full-frame generation — Use the inspected photographic result as model input | S90 |
| 5701 | Slice 12 — Combined movement multiplies the subject's current scale | S58 |
| 5715 | Slice 12 — A vacancy's first retained snapshot owns its original hole | S59 |
| 5731 | Slice 12 — Density preparation does not publish a partial move | S33 |
| 5749 | Full-frame creation — Preserve exact input execution in generation intent | S38 |
| 5764 | Full-frame creation — Sample constant coverage at the intended viewport density | S38 |
| 5779 | Retouch — Original-relative coordinates and supported photographic pixels | S63 |
| 5804 | Outpaint verification — Make cold fallback through a new edit, not cache surgery | S89 |
| 5820 | RAW reconstruction plan — Normal treatment with an explicit diagnostic escape | S92 |
| 5838 | RAW reconstruction plan — Preserve floating samples instead of adopting integer staging | S68 |
| 5858 | Full-frame refresh — Reuse an unchanged viewport recipe before normalizing geometry | S35 |
| 5876 | Full-frame refresh — Retained input follows existing fallback quality ranking | S37 |
| 5893 | Full-frame refresh — Failed upscale-only refresh preserves the previous purchase | S35 |
| 5909 | Full-frame refresh — Missing source bytes permit deterministic retained-graph evaluation | S37 |
| 5930 | Full-frame refresh — Unavailable retained bytes use the existing unavailable exit class | S37 |
| 5943 | Affine sampling — Reuse filter weights without changing the numerical recipe | S56 |
| 5962 | Native highlight recovery — Preserve complete physical cells at image edges | S68 |
| 5978 | Native highlight recovery — Retain fractional channel estimates | S68 |
| 5994 | Native highlight recovery — Ship derivative source with the native package | S68 |
| 6008 | RAW treatment — Carry decoder revision separately from recovery method | S69 |
| 6027 | RAW treatment — Composite provenance describes the primary photographic source | S69 |
| 6046 | RAW treatment — Require native treatment for online previews without demoting offline pixels | S69 |
| 6066 | RAW treatment — Preserve the adapter-name fallback for unavailable version metadata | S69 |
| 6086 | RAW diagnostics — Keep each oracle run immutable and publish a latest-report pointer | S69 |
| 6104 | RAW diagnostics — Adopt recovery explicitly above the low-level decoder default | S69 |
| 6121 | Export safety — Historical mount hints may reserve a destination, never identify a source | S12 |
| 6145 | Verification — Give the source-checkout gold exam disposable command launchers | S81 |
| 6161 | Daemon status — Report background activity separately from the command queue | S17 |
| 6178 | Generation exclusions — Report guidance rather than pretend native conditioning | S84 |
| 6198 | Daemon startup — Return the acknowledgement already received | S17 |
| 6213 | Reference strength — More freedom to vary, not a promise of exact pixels | S91 |
| 6235 | Hosted smoke selection — Keep fast public-boundary checks | S80 |
| 6253 | RAW interpolation — Balance the working channels, not the public image | S66 |
| 6278 | Preview color detail — Keep color samples at image resolution | S49 |
| 6300 | Removal — Leave an unverifiable file at a reused locator untouched | S11 |
| 6320 | Library configuration — Replace one validated setting at a time | S23 |

## Superseded dispositions carried inside a consolidated entry

These previous entries survive, but their *claim* changed. Each is now stated as
superseded inside the named entry rather than as current behavior:

| Previous heading | Disposition |
|---|---|
| Slice 08a2 — Display RGB16 as the canonical graph artifact was unsound | Superseded; the current exact scene-linear float contract is in `S45`. |
| Slice 13a generate — Speculative reference transport superseded | Superseded; the current multipart edit transport is in `S84`. |
| Upscaler spike — Per-case reuse duplicated paid requests | Superseded; experiment-wide request identity is in `S40`. |
| Canvas sampling — Local supply satisfies demand | Superseded; the corrected supply rule is in `S61`. |
| Canvas contribution — Reuse final projected mask coverage | Superseded; the corrected visibility rule is in `S61`. |
| Slice 12d1 review — Generation refresh refuses pre-fill transform geometry | Superseded inside `S35`: 12d2's single affine rebuild replaced the bounded refusal. |
| Slice 13a — Require a dimension-retaining current base before provider work | Superseded inside `S85`: cropped, rotated and reduced full-frame inputs are implemented, so the pre-provider geometry refusal is stale and is no longer stated as current behavior. |
| Slice 11a — An incomplete model release is represented, not counterfeited | Folded into `U26`; the manifest now reads `status:"ready"` with real digests, so the refusal machinery is retained but dormant and the outstanding item is publication authority. |
| Slice 12f plan — Frame ownership precedes canvas growth · Spec maintenance — Preview cache safety lands before new render producers | Both are now-completed plan resequencing, banked together as `S88`. |
| Slice 01b — Rendered JPEG fallback uses quality 88 | Narrowed inside `S93`: slice 05 presets own delivery quality, so 88 now governs only preview and fallback encodes. |
| CI diagnostics — retain failed-test daemon logs · CI pressure — observe the host without collecting test data | Both merged into `S80` as **superseded machinery that should not be restored**; see the missing-behavior section below. |

## Discretion only

- **Slice 01b review — The envelope workbench is static and self-contained**
  (old line 2164). Verification tooling with no product contract: a report
  renders typed example envelopes into one standalone file with no live library,
  daemon or network. Recorded here as the pass's single compressed entry.

## Alleged missing promised behavior

Recorded separately from the ledger because the ledger states current behavior,
not audit allegations. Three domain drafts alleged undelivered promises. Root
checked each against source; two were stale and one is a genuine unmet target.

| Allegation | Source | Disposition |
|---|---|---|
| `reimagine`, `relight` and `generate` reject the global per-command upscale flags, so agents cannot suppress or redirect paid density work | provider draft | **Stale.** All four generative verbs now parse `--upscale`, `--no-upscale` and `--upscale-model` and forward request intent into the shared density policy; contradictory flags are a usage error before the library opens. Standalone `generate` remains deliberately opt-in rather than `auto`, since a source-less generation has no destination density to match. Banked in `S36`. |
| Hosted CI keeps no failure evidence after the smoke cutover, so a red run gives assertion text and nothing behind it | build draft | **Not a missing promise, and not to be restored.** The hosted subset starts no daemon, compiles no photo runtime and downloads no models, so there are no daemon logs to upload and no host contention to sample. The product diagnostic survives untouched: the CLI still names a dead daemon's private local log path. Both the log upload and the host-pressure sampler are recorded as superseded inside `S80`. |
| Automatic fine-edge segmentation quality is not delivered | render draft | **Confirmed unmet** as `U1`; this is not an exhaustive statement of remaining spec work. Manual correction on the same selection layer is implemented and verified; it is manual control, not evidence that automatic edge quality improved. |

Three further draft observations were checked and are **not** missing behavior,
so each is stated as a boundary inside its entry rather than as a gap:
export renders active markup because the markup node is the active output root
(`S64`); normalized `fill --move` keeps its documented unit range while absolute
base coordinates remain available for exterior destinations (`S58`); and
`fill --move` already maps a non-subject-layer target to `usage` (`S2`).

## Draft claims corrected before entry

The five domain proposals were read-only input. These claims were checked
against current source and did **not** enter the ledger as written:

| Draft claim | Correction applied |
|---|---|
| Import's per-unit conflicts and the typed batch-envelope aggregation are one contract | They are two. Per-unit conflicts retain paths and human-readable message text and produce `partial` (`S5`); the separate batch owner preserves typed, order-independent all-failure codes (`S6`). |
| Reusing an occupied copy destination is a byte-for-byte equivalence check | It is sampled identity plus a full hash **when one is stored** (`S4`). |
| The four `64_000_000` literals are one limit that should be centralized | They are four contracts with different owners — canvas growth, standalone generation size, markup text-raster allocation and the fake upscaler's advertised capability — that coincide numerically. `U12` states the canvas ceiling and names the coincidence explicitly; no centralizing refactor is proposed. |
| A full-raster retouch mask is an unsound design to be redone | Recorded as a storage tradeoff and an input to the still-open retention measurement inside `S57`. It is not a demonstrated correctness failure and not authority to redesign mask storage or add a collection policy. |
| `--strength` feathering belongs to free fitting | Explicit strength feathers in every fit mode; only the *default* feather differs, and strict protection is measured outside the effective mask (`U16`). |
| The one-photo multimodal embedding dialect is settled | It stays explicitly provisional inside `S20` until a purpose-key live run accepts or rejects it. |

## Scope limitations of this consolidation pass

Stated so nothing is assumed:

- **Docs only, and read-only verification.** Two markdown files changed. No
  product surface changed in the ledger rewrite; accompanying slice-policy fixes
  align existing instructions with the root Mac-only acceptance policy. No
  source, test, configuration or workflow file was touched, and no test, build,
  provider call or camera access was run by the docs work. Root commissioned a
  separate read-only identity/export check while the full local gate was
  executing in the root checkout throughout. Every claim about current behavior
  in this reconciliation rests on source reading and explicitly scoped earlier
  evidence, not a new execution result from the docs pass.
- **Verification was targeted, not exhaustive.** Load-bearing or contested claims
  were checked against source: the per-command upscale parsers, the full-frame
  generation handler's source handling, the four raster-limit literals, the
  `fill --move` and retouch error mappings, the fill fit/feather constants and
  `--norm` range validation, the copy-destination identity check, the import
  conflict shape, the settings registry's rejection of the daemon idle value, the
  segmentation mask threshold and grounding cap, the model manifest state, and
  the CI and publish workflows. Entries outside that set were consolidated from
  the previous ledger's own text plus the returned domain audits.
- **The domain drafts were not accepted as authority.** Their proposed text was
  treated as review input; where a draft and the root dispositions in
  [`final-correctness-review.md`](final-correctness-review.md) disagreed, the
  dispositions won. No approval is inferred from a draft.
- **Coverage mapping is not source verification.** Every previous heading has a
  proposed disposition in the table above. What the drafts named as their
  unreviewed remainders — preview
  materialization and hashing, graph and document entries, provider transport,
  decoder and fixture entries, the canvas cluster, markup and retouch internals —
  is covered here, but by consolidation from the previous ledger and the
  dispositions, not by a fresh independent audit of each owner. Two areas retain
  a genuinely open technical question rather than an unwritten entry: native mask
  polarity, which blocks live masked fill entirely (`S28`), and the first live
  upscaler adapter (`U2`).
- **Formatting defect fixed in passing.** The previous *Corrupt RAW fixture*
  entry ended at its verdict with no confidence line, and the previous *Public
  undo — Document edits* entry ran into the next heading without one. Both facts
  are carried into `S82` and `S47` with confidence stated.
- **Not done, deliberately.** This pass marks nothing complete, archives nothing,
  changes no TODO or requirement, adds no new requirement, and demands no
  decision. Pairing workbench layout and automatic selection quality remain the
  separate unresolved acceptance items the plan already names.
