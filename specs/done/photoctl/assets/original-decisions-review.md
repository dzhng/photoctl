# Original decision reconciliation

Read-only audit of the kickoff map's D1–D40, D7b and A′ against the active spec
and current owners, followed by root verification of disputed contracts. This
is decision coverage, not a new execution or a claim that every source line was
independently reviewed. Current test evidence lives in the
[local closeout record](final-closeout-2026-09-08.md).

"Implemented" identifies the owning code and retained scoped evidence. This
audit preceded the user's S94/S95 acceptance: its open presentation/selection
references are historical, resolved by those entries in `../choices.md`.
Conditional provider quality remains unverified; no old map wording reintroduces
removed platform, SSH or Lightroom gates.

| Decision | Current disposition and owner |
| --- | --- |
| D1 | Locators and offline sources implemented in `packages/library/src/locators.ts` and `packages/commands/src/graph-source.ts`; retained pixels can support offline edits/export under the amended contract. |
| D2 | User workflow context; actual Lightroom verification is explicitly optional. No additional implementation. |
| D3 | Gateway transport implemented in `packages/providers/src/gateway.ts`; explicitly configured upscalers use their separate boundary. |
| D4 | Provider interfaces separate transport from operations in `packages/providers/src/adapters/`; a future cloud service is not required. |
| D5 | Missing configuration fails explicitly; `scripts/gold-exam.sh` remains keyless. |
| A′ | Flat pinned buffers are superseded by `packages/render/src/graph/` and scene-linear artifacts. Develop compensation uses provable composition rules, otherwise reports stale. |
| D6 | Daemon, lock, queue and recovery implemented in `apps/daemon/src/server.ts` and `packages/commands/src/daemon-client.ts`. Disappearance watching concerns the library; original availability is resolved separately. |
| D7 | CPU SAM and manual box/brush selection implemented in `packages/commands/src/handlers/segment.ts`; automatic fine edges remain unaccepted. |
| D7b | Structured instances feed SAM through the segment handler and structured adapter; live grounding quality is unverified. |
| D8 | Retained layers and nonmutating dry runs implemented by the segment handler and `packages/render/src/layers/`. |
| D9 | Sampled identity and collision handling implemented in `packages/library/src/identity.ts`; identities now belong to originals with multiple locators. |
| D10 | Machine/human envelopes, exits and streaming implemented by `packages/protocol/` and `apps/cli/src/output.ts`; current batch envelopes supersede kickoff examples. |
| D11 | Ordinary local movement and vacancy implemented in `packages/render/src/layers/operations.ts`; generated-layer density follows the later explicit processing policy. |
| D12 | Shared native transforms/resampling implemented in `crates/photoctl-image/src/resample.rs` and `packages/render/src/transforms.ts`. |
| D13 | Absolute/relative transforms and original-base coordinates share the transform and coordinate owners. |
| D14 | CIRAW/LibRaw decoder boundary and vendored source implemented; SSH/headless acceptance removed. |
| D15 | Original vacancy silhouette retained by the layer operations owner across later moves. |
| D16 | Magenta solid vacancy placeholder implemented by the same owner. |
| D17 | Rating, flag, label and XMP mapping implemented by cull commands and `packages/library/src/xmp/`. |
| D18 | Named culling/navigation/removal and delivery options implemented by cull/export handlers. |
| D19 | Source writes remain explicit XMP operations; original byte protection is separate from allowing edited files beside originals. |
| D20 | Catalog-owned metadata, explicit sync and divergence reporting implemented in `packages/library/src/xmp/`. |
| D21 | One develop dictionary and preset/reset/copy/filter mutations implemented in `packages/render/src/develop/` and its command handlers. |
| D22 | Amended to scene-linear Float32 composition in `crates/photoctl-image/src/mask.rs`, as slices 08/10 already specify. Only the documented normal blend is promised. |
| D23 | Pinned source previews, lazy derived views and preview pruning implemented; canonical/purchased retention is a separate bucket. |
| D24 | Structured auto-enhance and local horizon/crop implemented in `packages/commands/src/handlers/develop-auto.ts` and native horizon code. Live aesthetic quality is conditional. |
| D25 | Fixed configurable model table implemented. Doctor validates/resolves identifiers locally, not remote server recognition or availability. |
| D26 | Local deterministic processing and remote generative boundaries implemented; no local generative weights added. Configured upscaling is the later documented exception to the simplified taxonomy. |
| D27 | Amended to preserve provider-returned dimensions, with graph-owned placement and rejection of unexplained aspect changes. Slice 09's obsolete `resampled` description is corrected. |
| D28 | Soft source/stale warnings implemented; invalid requests, unavailable required pixels and destination failures still fail, and explicit collision skip need not write. |
| D29 | Structured-data guarantee implemented with schema-constrained requests and Zod; the named SDK helper was replaced by the current slice-09 adapter contract. |
| D30 | Independent cache root implemented in `packages/importer/src/cache.ts`; a library can share a folder with originals. |
| D31 | `halfvec(3072)` cosine HNSW search implemented in `packages/library/src/migrations/0008-search.ts`. |
| D32 | Pinned culling tier and cataloged genuine embedded JPEG ranges implemented; kickoff dimensions describe fixtures, not every camera. |
| D33 | Explicit manual/automatic embedding and import estimates implemented; ambient-key auto-default is superseded by the consent policy. Live request dialect remains provisional. |
| D34 | Audit found single-photo disk removal omitted required confirmation. The focused correction restores `--yes` for every disk removal while preserving multi-photo confirmation and Trash behavior. |
| D35 | No unblur implementation required. `restore` is explicitly repurposed to catalog recovery, not provider restoration. |
| D36 | Safe-open refusal and diagnostics implemented in `packages/library/src/open.ts`; PG-major mismatch uses restore guidance, not automatic reset. |
| D37 | SQL metadata snapshots and restore implemented by the library owner; these do not promise backup of canonical artifact bytes. |
| D38 | Real CLI/process and Docker coverage retained; hosted full-suite work is explicitly superseded by smoke-only CI and local closeout. |
| D39 | Local luminance/color NLM implemented in `crates/photoctl-image/src/develop/noise_reduction.rs`; learned NR remains deferred. |
| D40 | CPU-only SAM implemented in `crates/photoctl-image/src/sam2.rs`; dormant CoreML conditions are not outstanding work. |

The D34 correction is a restored approved requirement, not a new discretionary
restriction. D22/D27/D29 documentation names existing later contracts rather than
changing pixels, provider requests or acceptance to make the audit pass. Root
checked the removal guard, Float32 compositor, intrinsic-image normalizer and
local identifier resolution before adopting those dispositions.
