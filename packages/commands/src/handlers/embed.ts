import { countEmbeddingCandidates, type LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type Envelope, type StderrEvent } from "@photoctl/protocol";
import { readProviderSettings, resolveModels } from "@photoctl/providers";
import { parseArguments } from "../arguments.js";
import { batchEnvelope, resolveBatchInputs } from "../batch.js";
import { EMBED_PROVIDER_BATCH_SIZE, embedPhotoBatch, type EmbedItemResult } from "../embedding.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { createProgressHeartbeat } from "../progress.js";

const EMBED_ALL_FAILURE_LIMIT = 100;
const EMBED_EXPLICIT_ID_LIMIT = 1_000;
type EmbedFailure = Extract<EmbedItemResult, { ok: false }>;

export async function embedCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  emit?: (event: StderrEvent) => void | Promise<void>,
): Promise<Envelope> {
  if (args.some((argument) => argument !== "--all" && argument.length > 36)) {
    throw new PhotoctlError("usage", "Photo IDs and prefixes must be at most 36 characters");
  }
  const parsed = parseArguments(args, { flags: ["--all"] });
  if (Number(parsed.flags.has("--all")) + Number(parsed.positionals.length > 0) !== 1) {
    throw new PhotoctlError("usage", "embed requires --all or one or more photo IDs");
  }
  if (parsed.positionals.length > EMBED_EXPLICIT_ID_LIMIT) {
    throw new PhotoctlError(
      "usage",
      `embed accepts at most ${EMBED_EXPLICIT_ID_LIMIT} explicit photo IDs; use --all for a library backfill`,
    );
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const resolved = parsed.flags.has("--all")
      ? []
      : await resolveBatchInputs(lease.handle, parsed.positionals);
    const ids = resolved.filter((item) => item.ok).map((item) => item.id);
    const total = parsed.flags.has("--all")
      ? await countEmbeddingCandidates(
          lease.handle,
          resolveModels((await readProviderSettings(lease.handle)).models).embed,
        )
      : resolved.length;
    const progress = createProgressHeartbeat({
      emit,
      phase: "embed",
      total,
      initialDone: resolved.length - ids.length,
    });
    await progress.start();
    try {
      if (parsed.flags.has("--all")) {
        return await embedAll(lease.handle, env, cwd, progress);
      }
      const embedded: EmbedItemResult[] = [];
      for (let offset = 0; offset < ids.length; offset += EMBED_PROVIDER_BATCH_SIZE) {
        const batchIds = ids.slice(offset, offset + EMBED_PROVIDER_BATCH_SIZE);
        const batch = await embedPhotoBatch({
          handle: lease.handle,
          env,
          cwd,
          ids: batchIds,
          limit: EMBED_PROVIDER_BATCH_SIZE,
          includeCurrent: true,
        });
        embedded.push(...batch.results);
        await progress.advance(batchIds.length);
      }
      const byId = new Map(embedded.map((result) => [result.id, result]));
      return batchEnvelope(
        resolved.map((item) =>
          item.ok ? (byId.get(item.id) ?? { id: item.id, ok: false, code: "file_offline" }) : item,
        ),
      );
    } finally {
      await progress.stop();
    }
  } finally {
    await lease.release();
  }
}

async function embedAll(
  handle: LibraryHandle,
  env: RequestEnv,
  cwd: string,
  progress: { advance(count: number): Promise<void> },
): Promise<Envelope> {
  let succeeded = 0;
  let failed = 0;
  const failureCodes = new Set<EmbedFailure["code"]>();
  const failures: EmbedFailure[] = [];
  let afterId: string | undefined;
  while (true) {
    const batch = await embedPhotoBatch({
      handle,
      env,
      cwd,
      limit: EMBED_PROVIDER_BATCH_SIZE,
      afterId,
    });
    for (const result of batch.results) {
      if (result.ok) succeeded += 1;
      else {
        failed += 1;
        failureCodes.add(result.code);
        if (failures.length < EMBED_ALL_FAILURE_LIMIT) failures.push(result);
      }
    }
    await progress.advance(batch.results.length);
    if (batch.candidateIds.length < EMBED_PROVIDER_BATCH_SIZE) break;
    afterId = batch.candidateIds.at(-1);
  }
  if (failed === 0) {
    return {
      schema: 1,
      ok: true,
      summary: { ok: succeeded, failed: 0 },
      results: [],
      warnings: [],
    };
  }
  return {
    schema: 1,
    ok: false,
    code: succeeded > 0 || failureCodes.size > 1 ? "partial" : failures[0]!.code,
    data: { failures_omitted: failed - failures.length },
    summary: { ok: succeeded, failed },
    results: failures,
    warnings: [],
  };
}
