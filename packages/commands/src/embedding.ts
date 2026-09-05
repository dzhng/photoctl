import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import {
  selectEmbeddingCandidates,
  upsertPhotoEmbedding,
  type LibraryHandle,
} from "@photoctl/library";
import { PhotoctlError, type EmbedResult } from "@photoctl/protocol";
import {
  createEmbeddingAdapter,
  GatewayClient,
  readProviderSettings,
  resolveModels,
} from "@photoctl/providers";
import { readFile } from "node:fs/promises";
import { cacheBase, readLibraryId, type RequestEnv } from "./context.js";

export const EMBED_PROVIDER_BATCH_SIZE = 50;

export type EmbedItemResult = EmbedResult;

export async function embedPhotoBatch(options: {
  handle: LibraryHandle;
  env: RequestEnv;
  cwd: string;
  ids?: readonly string[];
  limit?: number;
  includeCurrent?: boolean;
  afterId?: string;
  signal?: AbortSignal;
}): Promise<{ results: EmbedItemResult[]; candidateIds: string[] }> {
  const settings = await readProviderSettings(options.handle);
  const model = resolveModels(settings.models).embed;
  const candidates = await selectEmbeddingCandidates(options.handle, model, {
    ...(options.ids ? { ids: options.ids } : {}),
    limit: options.limit ?? 50,
    includeCurrent: options.includeCurrent,
    afterId: options.afterId,
  });
  if (candidates.length === 0) return { results: [], candidateIds: [] };
  if (!options.env.gatewayApiKey) {
    return {
      candidateIds: candidates.map(({ id }) => id),
      results: candidates.map(({ id }) => ({ id, ok: false, code: "provider_unconfigured" })),
    };
  }
  const cacheRoot = cacheRootForLibrary(
    await readLibraryId(options.handle),
    cacheBase(options.env, options.cwd),
  );
  const ready: Array<{ id: string; jpeg: Buffer }> = [];
  const results: EmbedItemResult[] = [];
  for (const candidate of candidates) {
    try {
      const jpeg = await readFile(pinnedEmbeddedJpegPath(cacheRoot, candidate.id));
      if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
        throw new Error("invalid JPEG");
      }
      ready.push({ id: candidate.id, jpeg });
    } catch {
      results.push({ id: candidate.id, ok: false, code: "file_offline" });
    }
  }
  if (ready.length === 0) {
    return { results, candidateIds: candidates.map(({ id }) => id) };
  }
  const gateway = new GatewayClient({
    apiKey: options.env.gatewayApiKey,
    baseUrl: options.env.gatewayUrl,
  });
  const adapter = createEmbeddingAdapter({
    model,
    request: async (body, signal) => await gateway.embeddings(body, signal),
  });
  for (let index = 0; index < ready.length; index += 1) {
    const item = ready[index]!;
    if (options.signal?.aborted) break;
    let embedded: Awaited<ReturnType<typeof adapter.images>>;
    try {
      // The versioned live candidate is defined for exactly one content-parts
      // item; widening it before that shape is accepted would invent a second
      // untested provider contract.
      embedded = await adapter.images([item.jpeg], options.signal);
    } catch (error) {
      if (options.signal?.aborted) break;
      const code =
        error instanceof PhotoctlError && error.code === "provider_unconfigured"
          ? "provider_unconfigured"
          : "provider_busy";
      results.push({ id: item.id, ok: false, code });
      if (code === "provider_unconfigured") {
        for (const skipped of ready.slice(index + 1)) {
          results.push({ id: skipped.id, ok: false, code });
        }
        break;
      }
      continue;
    }
    await upsertPhotoEmbedding(options.handle, item.id, embedded.model, embedded.vectors[0]!);
    results.push({ id: item.id, ok: true, model: embedded.model });
  }
  return { results, candidateIds: candidates.map(({ id }) => id) };
}
