# 09 — 9a provider contract + fake gateway + doctor · 9b spikes · 9c embed worker + hybrid search

## API seam
- **9a** `packages/providers/src/{gateway.ts,adapters/*.ts,table.ts,prompts/*.ts,cost.ts}`: all calls are OpenAI-compatible
  routes under `PHOTOCTL_GATEWAY_URL/v1` (default Vercel): `chat/completions` (+`response_format:json_schema`, D29),
  `embeddings`, `images/edits` (multipart, mask), `images/generations`. `ImageModelAdapter{ id; mask:"native"|"instruction+composite";
  maskPolarity:"transparent-edits"|"white-edits"|"unverified"; buildEdit(op, crop, mask, prompt, seed); normalize(res, sentDims)
  → {png, resampled, warnings} }` and `StructuredModelAdapter{ id; ask(schema, images, prompt) }` (frame conversion inside).
  Fixed table (D25; never read `modalities`): edit/generate → `openai/gpt-image-2`; structured → `google/gemini-3.1-flash`;
  embed → `google/gemini-embedding-2`; overrides in `settings.models.*` and `--model`. Key `AI_GATEWAY_API_KEY`; missing →
  `provider_unconfigured` 69; 429 → `provider_busy` 75 after bounded retry. `doctor` resolves configured ids. Cost table delegated
  (placeholder 0 + warning until priced). Fake gateway implements exactly the four routes: PNG at sent dims (modes
  `wrongdims|wholeframe`), canned `box_2d`, vectors = deterministic hash of request bytes.
- **9b** `probe:toast` (5 000 rows × 20 UPSERT on `halfvec(3072)`) → G5; reproduced ⇒ writes are DELETE+INSERT. `smoke:embed-shape`
  (key) records the accepted multimodal request as a fixture.
- **9c** migration (next number): `embeddings(photo_id pk, model, vec halfvec(3072), created_at)` + HNSW cosine; generated tsvector
  over tags/filename/folder + GIN. `apps/daemon/src/workers/embed.ts` (drain shape lifted from `~/dev/duet-agent/src/memory/
  embedding-worker.ts`, external: batch 50, yield between batches derived together with the poll ceiling); input = the 1616
  tier JPEG; query = text mode; `init --embed auto|manual`; `embed [--all|<id…>]`; import result `embeddings:{queued, est_usd}`.
  `packages/library/src/search/rrf.ts` (k=60); `search <q> [--limit 50] [--stream]` → `data:{hits:[{id,file,score,sources}]}`;
  without a key → text-only hits + `provider_unconfigured` warning.

## Verification
`provider-unconfigured.test.ts`; `provider-fake.test.ts` (dims-mismatch → `resampled:true`; `doctor` lists ids); `model-table.test.ts`;
`search-hybrid.test.ts` (a tag-only hit and a vector-only hit both appear; RRF order by ids); `embed-drain.test.ts` (`rate` p95 ≤ 2×
warm `show` p50 while 30 batches drain); `embed-consent.test.ts`; `migrate-upgrade` extended; unit `rrf.test.ts`.

## Delegated: retry policy; batch size.
## Must stay green: 01–06 (+07/08 when landed). Deps: 02, 04. Firewall: Vercel only; no `generate` here; no free-tier models.
