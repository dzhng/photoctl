# 09 — 9a provider + upscaler contracts · 9b non-blocking spikes · 9c embed worker + hybrid search

## Implementation status

**9a, the non-blocking 9b probes, and keyless 9c are complete.** The implemented boundary includes the four-route Vercel gateway,
fixed model resolution, structured/image adapters, an independent explicitly configured upscaler registry and deterministic fake,
doctor diagnostics, placeholder cost reporting, the shared Rust display-sRGB resampler, and bounded external-execution events and
provenance on the existing DAG execution owner. Successful generate/upscale evaluations cannot commit without provenance matching
their immutable adapter/model recipe.

Evidence: provider, upscaler, fake-gateway, doctor, graph-event/inspection, recipe, evaluator, store, and migration suites pass
together; the Rust resampler unit passes independently. `probe:toast` completed the exact 5,000-row × 20-cycle workload without
reproducing the TOAST fault, so 9c keeps UPSERT unless later machine evidence contradicts G5. Both live spikes preserve a durable
`not_run:unconfigured` verdict without treating ambient credentials as consent. The upscaler spike executes an adapter supplied
through the 9a registry boundary after explicit configuration, using caller-supplied sources and controls, and writes both prompt
arms, bounded telemetry, drift, and a contact sheet. The live multimodal request fixture and live model/control comparison remain
evidence-gated; no live contact sheet was produced. Schema v8, explicit-consent image embedding, the daemon's bounded backfill,
and indexed hybrid search are implemented without claiming the still-unaccepted live request candidate as provider evidence.

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
  parameters, input node/artifact hashes, recipe version, execution id, adapter/model versions when known, and provider request id.
  Auth headers, signed URLs, and raw debug bodies are never stored. Provider records are bounded so `graph node` fits one frame.
- **9b** `probe:toast` (5 000 rows × 20 UPSERT on `halfvec(3072)`) → G5; reproduction would have selected DELETE+INSERT. The
  committed G5 run did not reproduce it, verified all 5,000 rows, and therefore selects UPSERT for 9c on this PGlite build. `smoke:embed-shape`
  runs only with `PHOTOCTL_EMBED_SMOKE_API_KEY`; a successful live run records the accepted, redacted multimodal request as its
  fixture, while the current keyless evidence is explicitly `not_run:unconfigured`. An HTTP success with the wrong shape records
  `response_shape` and a bounded summary of the observed embedding count and dimensions instead of conflating transport success
  with contract acceptance. Unexpected database failures overwrite stale G5 PASS evidence with an unsettled verdict before exit.
- **9b upscaler spike (never blocking):** first make the deterministic fake adapter prove fixed-scale cover, adapter limits,
  adapter-native tiling metadata, an unexplained aspect mismatch, too-small output, and transport failure without credentials.
  If and only if an upscaler is explicitly configured, compare the guarded inherited prompt against a minimal preservation prompt
  on the slice-13 crops. Record output dimensions, latency, cost, resolved controls, and visible drift; choose the release-pinned
  adapter/model plus balanced creativity/resemblance values from that evidence. Missing explicit adapter configuration records
  `not_run:unconfigured` and does not block 09, 12, 13, or closeout. Research starting points: [VOSR](https://github.com/cswry/VOSR),
  [Magnific Creative API](https://docs.magnific.com/api-reference/image-upscaler-creative/image-upscaler),
  [Topaz Bloom](https://www.topazlabs.com/bloom), and
  [Photoshop's Firefly/Gigapixel/Bloom comparison surface](https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/enhance-image-quality-with-generative-upscale.html).
- **9c** migration (next number): `embeddings(photo_id pk, model, vec halfvec(3072), created_at)` + HNSW cosine; generated tsvector
  over tags/filename/folder + GIN. `apps/daemon/src/workers/embed.ts` (drain shape lifted from `~/dev/duet-agent/src/memory/
  embedding-worker.ts`, external: batch 50, yield between batches derived together with the poll ceiling); input = the 1616
  tier JPEG; query = text mode; `init --embed auto|manual`; `embed [--all|<id…>]`; import result `embeddings:{queued, est_usd}`.
  `packages/library/src/search/rrf.ts` (k=60); `search <q> [--limit 50] [--stream]` → `data:{hits:[{id,file,score,sources}]}`;
  without a usable provider → text-only hits + a provider warning; local catalog/search failures remain hard errors.
  Foreground embed progress uses the existing stderr frame as an idle heartbeat: one frame at start and batch completion, plus one
  every five seconds while provider I/O is pending; the daemon client has an idle ceiling of at least 31 seconds, never below a
  longer queue-admission budget, and each frame resets it. Search uses the same heartbeat while its optional query-vector request,
  bounded retry delay, or response parse is pending.
  Explicit ID batches retain per-item results and accept at most 1,000 IDs. `--all` retains exact success/failure totals, at most
  100 failure results, and `data.failures_omitted`; it never accumulates one success row per library photo. Resolved model IDs are
  capped at 256 bytes, so explicit result rows also have a fixed maximum size.

### 9c implementation evidence

Schema v8 keeps normalized file and tag rows authoritative: database triggers refresh one materialized search-text input, and a
stored generated `tsvector` plus GIN index serves the text arm. Embeddings use the G5-selected UPSERT and retain a
`halfvec(3072)` HNSW cosine index, but search materializes the selected model before exact cosine ranking so a partial mixed-model
backfill cannot underfill through HNSW post-filtering; RRF uses `k=60`. `embed --all` idempotently fills missing or stale-model rows, while explicit IDs
request a refresh. Auto-mode imports price the queued default-model work at $0.00045 per photo and warn rather than borrow that
price for an unknown model override. The daemon selects 50 catalog rows at a time, isolates each provisional one-image provider request, yields the
database command lane between batches, and suppresses automatic work unless the library was initialized with `--embed auto` and
a key is present. Each foreground command refreshes the worker's key, endpoint, cache root, and working directory before the next
batch, so a long-lived daemon never freezes startup configuration. Before dispatch, the daemon pauses the worker, aborts active
provider/backoff work, and awaits a database-safe point; it resumes from the same sweep position after dispatch. Its poll ceiling and free window come from one timing policy,
so changing the former changes the latter too. A constant-size cursor advances through every selected batch before failed rows
become eligible for the next sweep; one scalar deadline enforces the five-minute cooldown even after a foreground kick. Daemon
shutdown aborts the active provider request through the existing `provider_busy` boundary.
Gateway retry sleeps observe the same abort signal as the request, including injected test sleeps, so shutdown never waits for a
`Retry-After` delay. A malformed HTTP-success JSON body is a bounded `provider_busy` error with no response-body retention.
One 401/403/404 rejection represents shared credential/model/endpoint context: the command marks the rest of that selected
database batch failed without further provider calls, automatic work then sleeps until a foreground command supplies refreshed
context and kicks it again. HTTP 400 remains an isolated per-image failure and later items continue. Unexpected worker
setup/catalog failures produce one bounded diagnostic, do not reject daemon shutdown, and also
remain dormant until a later kick rather than spinning detached work.
Provider classification ends when a validated vector returns: an UPSERT or other local catalog failure escapes to the foreground
error boundary, or stops automatic work with one diagnostic, rather than being mislabeled and regenerated.
Foreground manual embedding uses the existing progress-frame path to keep a slow serial provider call visibly alive without
raising the 16 MiB frame ceiling. The final `--all` response is catalog-size independent apart from integer totals.

The built CLI/daemon drain gate completed 1,500 photos (30 batches) while foreground `rate` stayed inside the required p95 bound.
The migration, consent, per-item isolation, strict response-shape, provider-failure text-only fallback, streaming warning, tag-only/vector-only
hybrid retrieval, and RRF unit seams all pass keylessly. The production multimodal body remains the named
`openai-compatible-content-parts-candidate-v1`: an explicit `embed` command or saved automatic mode may attempt it, exactly one
photo per request, but only a successful purpose-key smoke can promote it from provisional. A live rejection requires a new
versioned shape; runtime code does not guess another dialect.

## Verification
`provider-unconfigured.test.ts`; `provider-fake.test.ts` (dims-mismatch → `resampled:true`; `doctor` lists ids);
`upscale-adapter.test.ts` (selection precedence, explicit configuration consent, fixed scales/limits, provenance redaction,
wrong-aspect rejection, failure result); `provider-events.test.ts` (generate + upscale emit distinct execution ids); `model-table.test.ts`;
`search-hybrid.test.ts` (a tag-only hit and a vector-only hit both appear; RRF order by ids); `embed-drain.test.ts` (`rate` p95 ≤ 2×
warm `show` p50 while 30 batches drain); `embed-consent.test.ts`; `migrate-upgrade` extended; unit `rrf.test.ts`.

## Human review (non-blocking)
When configured, `wb upscale-spike` produces a contact sheet with a guarded/minimal pair for every supplied source crop, holding
the caller-selected controls constant. Run `compare-screenshots` on each pair and `screenshot-critique` last. Open with
`preview-shots`, wait about five minutes, then decide from the evidence and record pinned model/control values only after live
evidence supports them. No explicit adapter configuration means no contact sheet and no failure.

## Delegated: bounded retry policy; batch size; adapter-internal color conversion implementation.
## Must stay green: 01–08. Deps: 02, 04, 08a. Firewall: the general gateway remains Vercel-only; only the external
`UpscaleAdapter` boundary may use an explicitly configured purpose-built service. No `generate` here; no free-tier models; no
runtime capability discovery or ambient-credential selection.

## 9b evidence

- `specs/photoctl/assets/gates/G5-halfvec.txt` is the rerunnable machine verdict from the exact PGlite workload.
- `specs/photoctl/assets/gates/embed-shape.json` is the key-gated live smoke record. It deliberately contains no accepted request
  until the gateway accepts one; fake-gateway tests prove successful records redact both credentials and image bytes.
- `specs/photoctl/assets/gates/upscale-spike.json` records that no live adapter was explicitly configured. With no output pair,
  there was no visual artifact to open, compare, or critique, and no release model or balanced-control choice was invented.
- A disposable configured-fake run produced a 984 × 360 opaque contact sheet with complete guarded/minimal labels and visibly
  distinct arms (`parityDistance=0.53785`; edge-energy ratio `0.98857`). Direct inspection and the unprimed critique accepted it
  only as proof that both adapter invocations are framed and reviewable. This says nothing about upscaler quality, does not select
  an arm, and does not replace the still-unrun live comparison.
