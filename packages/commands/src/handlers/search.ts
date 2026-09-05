import { hybridSearch, type LibraryHandle } from "@photoctl/library";
import {
  PhotoctlError,
  type Envelope,
  type SearchData,
  type SearchHit,
  type StderrEvent,
  type Warning,
} from "@photoctl/protocol";
import {
  createEmbeddingAdapter,
  GatewayClient,
  readProviderSettings,
  resolveModels,
} from "@photoctl/providers";
import { basename } from "node:path";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { createProgressHeartbeat } from "../progress.js";

export async function searchCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  stream?: (row: SearchHit) => void | Promise<void>,
  emit?: (event: StderrEvent) => void | Promise<void>,
): Promise<Envelope<SearchData>> {
  const parsed = parseArguments(args, { flags: ["--stream"], options: ["--limit"] });
  if (parsed.positionals.length === 0) throw new PhotoctlError("usage", "search requires a query");
  const query = parsed.positionals.join(" ").trim();
  if (!query) throw new PhotoctlError("usage", "search requires a query");
  const limit = Number(parsed.options.get("--limit") ?? 50);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new PhotoctlError("usage", "--limit must be an integer from 1 to 50");
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    let vectorSearch: { vector: number[]; model: string } | undefined;
    let warning: Warning | undefined;
    if (env.gatewayApiKey) {
      const progress = createProgressHeartbeat({ emit, phase: "search", total: 1 });
      await progress.start();
      try {
        const settings = await readProviderSettings(lease.handle);
        const model = resolveModels(settings.models).embed;
        const gateway = new GatewayClient({ apiKey: env.gatewayApiKey, baseUrl: env.gatewayUrl });
        const vector = (
          await createEmbeddingAdapter({
            model,
            request: async (body) => await gateway.embeddings(body),
          }).text([query])
        ).vectors[0];
        if (vector) vectorSearch = { vector, model };
      } catch (error) {
        if (
          !(error instanceof PhotoctlError) ||
          !["provider_unconfigured", "provider_busy"].includes(error.code)
        ) {
          throw error;
        }
        warning = {
          code:
            error.code === "provider_unconfigured" ? "provider_unconfigured" : "provider_warning",
          message:
            error.code === "provider_unconfigured"
              ? "Vector search is unavailable because the Gateway configuration was rejected"
              : "Vector search is temporarily unavailable; returning text matches only",
        };
      } finally {
        try {
          await progress.advance(1);
        } finally {
          await progress.stop();
        }
      }
    } else {
      warning = {
        code: "provider_unconfigured",
        message: "Vector search is unavailable without an explicit Gateway key",
      };
    }
    const fused = await hybridSearch(lease.handle, query, limit, vectorSearch);
    const files =
      fused.length === 0
        ? []
        : (
            await lease.handle.query<{ photo_id: string; rel_path: string }>(
              `SELECT DISTINCT ON (photo_id) photo_id::text, rel_path
               FROM files WHERE photo_id = ANY($1::uuid[])
               ORDER BY photo_id, rel_path`,
              [fused.map((hit) => hit.id)],
            )
          ).rows;
    const fileById = new Map(files.map((file) => [file.photo_id, basename(file.rel_path)]));
    const hits: SearchHit[] = fused.flatMap((hit) => {
      const file = fileById.get(hit.id);
      return file ? [{ ...hit, file }] : [];
    });
    if (parsed.flags.has("--stream")) for (const hit of hits) await stream?.(hit);
    if (warning && parsed.flags.has("--stream")) {
      await emit?.({ event: "warn", ...warning });
    }
    return {
      schema: 1,
      ok: true,
      data: { hits: parsed.flags.has("--stream") ? [] : hits },
      warnings: warning ? [warning] : [],
    };
  } finally {
    await lease.release();
  }
}
