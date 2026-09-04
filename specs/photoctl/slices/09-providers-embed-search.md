# 09 — 9a provider + upscaler contracts · 9b non-blocking spikes · 9c embed worker + hybrid search

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
- **9a upscaling boundary:** `packages/providers/src/upscale/{adapter.ts,registry.ts,fake.ts}` owns
  `UpscaleAdapter{id;colorContract:"opaque-display-srgb";supportedScales;limits;upscale(input)}` independently of gateway
  transport. Inputs are `{artifact,scale,prompt?,fidelity?,creativity?,seed?}`; results are
  `{artifact,dimensions,frameMapping?,provenance}`. Color/profile conversion stays inside the adapter and adapter-version changes
  invalidate recipes. An adapter may use Vercel, a direct hosted service, or a future local runner; render/fill never branches on
  transport. Generic cross-adapter tiling is forbidden. Adapter-native tiling is allowed and recorded. When adapter limits cannot
  reach target density, the adapter returns its largest valid result and the caller reports `upscale_resolution_limited` after the
  one deterministic exact resize.
- **9a selection/consent:** release data pins one generative default; `settings.models.upscale` overrides it and
  `--upscale-model` wins per command. `generation.upscale` is `auto|off`, default `auto`; command flags `--upscale|--no-upscale`
  override it and a model override implies `--upscale`. `auto` may execute only after that adapter is explicitly configured;
  credentials merely present in the environment are not consent. Without configuration generation continues with
  `upscale_unconfigured`. Every successful node stores the resolved adapter/model/version, never `auto` or `latest`.
- **9a execution/provenance:** stderr emits one generalized provider event per external DAG execution:
  `{event:"provider",execution_id,node_kind,adapter,service,model,input_px,target_px,attempt}`. Canonical provenance stores typed
  parameters, input node/artifact hashes, recipe version, execution id, adapter/model versions when known, provider request id,
  seed, duration/cost, output dimensions/hash/availability, density verdict, and warnings. Unknown versions are `null`; credentials,
  auth headers, signed URLs, and raw debug bodies are never stored. Provider records are bounded so `graph node` fits one frame.
- **9b** `probe:toast` (5 000 rows × 20 UPSERT on `halfvec(3072)`) → G5; reproduced ⇒ writes are DELETE+INSERT. `smoke:embed-shape`
  (key) records the accepted multimodal request as a fixture.
- **9b upscaler spike (never blocking):** first make the deterministic fake adapter prove fixed-scale cover, adapter limits,
  adapter-native tiling metadata, an unexplained aspect mismatch, too-small output, and transport failure without credentials.
  If and only if an upscaler is explicitly configured, compare the guarded inherited prompt against a minimal preservation prompt
  on the slice-13 crops. Record output dimensions, latency, cost, resolved controls, and visible drift; choose the release-pinned
  adapter/model plus balanced creativity/resemblance values from that evidence. Missing credentials records `not_run:unconfigured`
  and does not block 09, 12, 13, or closeout. Research starting points: [VOSR](https://github.com/cswry/VOSR),
  [Magnific Creative API](https://docs.magnific.com/api-reference/image-upscaler-creative/image-upscaler),
  [Topaz Bloom](https://www.topazlabs.com/bloom), and
  [Photoshop's Firefly/Gigapixel/Bloom comparison surface](https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/enhance-image-quality-with-generative-upscale.html).
- **9c** migration (next number): `embeddings(photo_id pk, model, vec halfvec(3072), created_at)` + HNSW cosine; generated tsvector
  over tags/filename/folder + GIN. `apps/daemon/src/workers/embed.ts` (drain shape lifted from `~/dev/duet-agent/src/memory/
  embedding-worker.ts`, external: batch 50, yield between batches derived together with the poll ceiling); input = the 1616
  tier JPEG; query = text mode; `init --embed auto|manual`; `embed [--all|<id…>]`; import result `embeddings:{queued, est_usd}`.
  `packages/library/src/search/rrf.ts` (k=60); `search <q> [--limit 50] [--stream]` → `data:{hits:[{id,file,score,sources}]}`;
  without a key → text-only hits + `provider_unconfigured` warning.

## Verification
`provider-unconfigured.test.ts`; `provider-fake.test.ts` (dims-mismatch → `resampled:true`; `doctor` lists ids);
`upscale-adapter.test.ts` (selection precedence, explicit configuration consent, fixed scales/limits, provenance redaction,
wrong-aspect rejection, failure result); `provider-events.test.ts` (generate + upscale emit distinct execution ids); `model-table.test.ts`;
`search-hybrid.test.ts` (a tag-only hit and a vector-only hit both appear; RRF order by ids); `embed-drain.test.ts` (`rate` p95 ≤ 2×
warm `show` p50 while 30 batches drain); `embed-consent.test.ts`; `migrate-upgrade` extended; unit `rrf.test.ts`.

## Human review (non-blocking)
When configured, `wb upscale-spike` produces one contact sheet per variable: guarded-vs-minimal prompt first, then balanced control
strength. Use the exact same source/crop/mask in each pair; run `compare-screenshots` on each pair and `screenshot-critique` last.
Open with `preview-shots`, wait about five minutes, then decide from the evidence and record the pinned model/control values if the
user is silent. No credentials means no contact sheet and no failure.

## Delegated: bounded retry policy; batch size; adapter-internal color conversion implementation.
## Must stay green: 01–08. Deps: 02, 04, 08a. Firewall: the general gateway remains Vercel-only; only the external
`UpscaleAdapter` boundary may use an explicitly configured purpose-built service. No `generate` here; no free-tier models; no
runtime capability discovery or ambient-credential selection.
