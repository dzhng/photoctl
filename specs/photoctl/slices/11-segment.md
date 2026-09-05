# 11 — segment: 11a SAM 2.1 runtime, 11b verbs

## API seam
- **11a** `scripts/export-sam2.py` (pinned `facebook/sam2.1-hiera-small` commit) → `encoder.onnx`, `decoder.onnx`; sha256 + opset in
  `fixtures/models.json`; download base `settings.models_base_url` (OPEN: David-hosted release) with hash verification; cache
  `models/` pinned. `photoctl-image::sam2` via `ort` CPU EP (D40); encoder once per `(id, tier)` cached in the daemon; decoder per
  prompt. Input = develop render (offline: 1616 tier) letterboxed to 1024 (mapping in `coordinates.ts`); 256² logits → bilinear
  upsample → threshold 0 → base-res mask. Docker: weights fetched in the Dockerfile with hash check (missing → loud failure).
  G6: encode ≤ 4 s on M5 CPU, RSS ≤ 3 GB. `doctor --fetch-models`.
- **11b** `segment <id> --at x,y… [--dry-run]` (SAM point prompts; may combine with `--box`); `--text "…"` → `StructuredModelAdapter`
  Zod `{instances:[{box_2d:[ymin,xmin,ymax,xmax],label}]}` (0–1000, converted in the adapter) → SAM box prompt per instance, one layer each.
- `fixtures/a7c2.json` gains `sam_probes:[{at:[x,y], min_area_pct, max_area_pct}]` derived from frame content, not model output.
- `wb masks <id>`.

## Verification
`segment-at.test.ts` (mask contains the click; area within the probe band for each probe); `segment-text-fake.test.ts` (canned boxes
→ N layers in base coords; `--dry-run` → zero rows); `cargo test -p photoctl-image sam2::`.

## Delegated: embedding-cache eviction.
## Checkpoint: `wb masks` — edge quality on a hair/foliage crop.
## Must stay green: 01–10. Deps: 09a, 10. Firewall: no SAM 3; no macOS 27 API; CPU EP only.

## 11a keyless checkpoint (2026-09-05)
The pinned export, manifest, hash-fetch/cache, CPU ONNX session, 1024 letterbox, base-mask logit, and daemon encoder-cache contracts are implemented without inventing release bytes. The checked-in manifest remains `awaiting_export`, so `doctor --fetch-models` and the Docker `models` target fail loudly until David supplies the hosted base URL and a real export populates both hashes. G6 and the `wb masks` visual checkpoint remain open for that release-weight run; 11b verbs are not part of this checkpoint.

## 11b keyless command checkpoint (2026-09-05)

The command boundary accepts repeated base-coordinate point prompts, an optional box, text grounding, and non-mutating dry runs.
Text grounding uses the strict structured-provider schema, whose adapter is the only owner of normalized-box conversion; all
returned masks enter one atomic document revision, one subject layer per instance. Injectable local and structured adapters keep
the command contract keyless and make an empty text match a successful no-op. Production CLI/daemon construction of those adapters,
real `segment-at` probes, `a7c2` thresholds, the `wb masks` visual checkpoint, and G6 remain open with the release weights.
