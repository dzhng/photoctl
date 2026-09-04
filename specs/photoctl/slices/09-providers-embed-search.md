# 09 — 9a provider contract + fake gateway + doctor; 9b TOAST spike + embed-shape smoke; 9c worker + hybrid search

## Contract unlocked
The two-level provider interface exists (D25/D26) with a real-HTTP fake gateway so every generative
verb is playable before a key; `search` returns hybrid hits; embeddings run in the daemon with stated cost.

## API seam
- **9a** `packages/providers/src/{gateway.ts,model.ts,table.ts}`: `Gateway{ id; imageEdit(req); imageGenerate(req);
  structured(req, zodSchema) /*generateObject, D29*/; embed(req) }`; `ImageModelAdapter{ id; mask:"native"|
  "instruction+composite"; maskPolarity:"transparent-edits"|"white-edits"|"unverified"; buildEdit(op, crop, mask,
  prompt, seed); normalize(res, sentDims) → {png, resampled, warnings} /*D27*/ }`; fixed table (D25):
  fill/outpaint/reimagine/generate → `openai/gpt-image-2`; grounding/auto_enhance → `google/gemini-3.1-flash`;
  embed → `google/gemini-embedding-2`; overrides in `<lib>/config.json` and `--model`. `gateways/vercel.ts`
  (`AI_GATEWAY_API_KEY`; `/v1/images/edits` multipart for masks; PNG requested). `packages/test-harness`
  **fake gateway** service (compose): Vercel-shaped HTTP → canned PNG at sent dims, modes `wrongdims|
  wholeframe`, canned `box_2d`, fixed 3072-d vectors. Selected by `PHOTOCTL_GATEWAY_URL`. `provider_unconfigured`
  69 without a key. `doctor` resolves every configured model id. Cost table (data) → `cost_usd`.
- **9b** `spike:toast` (5 000 rows × 20 UPSERT on `halfvec(3072)`, PGlite 0.5.8 + pgvector 0.0.9) → verdict
  `assets/gates/G5-toast.txt`; if it reproduces, writes are DELETE+INSERT. `smoke:embed-shape` (with key) records
  the accepted multimodal request as a fixture.
- **9c** migration `0004-embeddings.ts` (`embeddings(photo_id pk, model, vec halfvec(3072), created_at)` + HNSW
  cosine; `photos.caption`; generated tsvector + GIN) + schema-v4 fixture. `apps/daemon/workers/embed.ts` (port of
  duet `embedding-worker.ts` drain shape: batch 50, relinquish between batches, cooldown; **yield vs poll ceiling
  derived together**); `init --embed auto|manual`; `photoctl embed [--all|<id…>]`; import result gains
  `embeddings:{queued, est_usd}` (D33). `packages/library/src/search/rrf.ts` (lift `recall.ts:391`, k=60) +
  `search <q> [--stream]`.

## Human can run
`PHOTOCTL_GATEWAY_URL=http://localhost:8787 photoctl generate --prompt x` (canned PNG imported, tag `generated`);
`photoctl search "wedding ceremony" --human`; `wb providers`, `wb search`.

## Verification
`provider-unconfigured.test.ts` (every generative verb → 69; gold exam untouched); `provider-fake.test.ts`
(dims-mismatch mode → `resampled:true` in the envelope); `model-table.test.ts` (config < `--model`);
`embed-starvation.test.ts` (port of `lock-starvation.test.ts`: a real `photoctl rate` gets the lock while the
worker drains 30 batches; budgets in Node terms); `search-hybrid.test.ts` (tsvector-only and vector-only hits
both appear; RRF order by ids); `embed-consent.test.ts`; `migrate-upgrade` v4; unit `rrf.test.ts`.

## Delegated: AI SDK vs raw fetch for edits; retry policy on 429 (bounded, 75); batch size.
## Checkpoint: none visual; `doctor` output when the key arrives.
## Must stay green: 01–08. Deps: 02, 04. Firewall: Vercel only; no OpenRouter file; no free-tier models; no image ops yet.
