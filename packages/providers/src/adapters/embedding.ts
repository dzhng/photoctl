import { PhotoctlError } from "@photoctl/protocol";
import type { GatewayResponse } from "../gateway.js";

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  requestId: string | null;
  attempts: number;
}

export interface EmbeddingAdapter {
  readonly model: string;
  text(inputs: readonly string[], signal?: AbortSignal): Promise<EmbeddingResult>;
  images(inputs: readonly Uint8Array[], signal?: AbortSignal): Promise<EmbeddingResult>;
}

export const EMBED_IMAGE_REQUEST_SHAPE = "openai-compatible-content-parts-candidate-v1";

export function createEmbeddingAdapter(options: {
  model: string;
  request(body: Record<string, unknown>, signal?: AbortSignal): Promise<GatewayResponse<unknown>>;
}): EmbeddingAdapter {
  const embed = async (input: unknown[], signal?: AbortSignal): Promise<EmbeddingResult> => {
    const response = await options.request(
      { model: options.model, dimensions: 3_072, input },
      signal,
    );
    const data = responseData(response.data);
    const dimensions = data.map((item) =>
      Array.isArray(item.embedding) ? item.embedding.length : null,
    );
    if (
      data.length !== input.length ||
      data.some(
        (item) =>
          !Array.isArray(item.embedding) ||
          item.embedding.length !== 3_072 ||
          !item.embedding.every((value) => typeof value === "number" && Number.isFinite(value)),
      )
    ) {
      throw new PhotoctlError("provider_busy", "The provider returned invalid embeddings", {
        expected_count: input.length,
        observed_count: data.length,
        dimensions: dimensions.slice(0, 8),
        truncated: dimensions.length > 8,
      });
    }
    return {
      vectors: data.map((item) => item.embedding as number[]),
      model: options.model,
      requestId: response.requestId,
      attempts: response.attempts,
    };
  };
  return {
    model: options.model,
    text: async (inputs, signal) => await embed([...inputs], signal),
    images: async (inputs, signal) => {
      if (inputs.length !== 1) {
        throw new Error(`${EMBED_IMAGE_REQUEST_SHAPE} requires exactly one image`);
      }
      return await embed(
        inputs.map((jpeg) => ({
          content: [
            { type: "text", text: "A photograph indexed for cross-modal retrieval." },
            {
              type: "image_url",
              image_url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`,
            },
          ],
        })),
        signal,
      );
    },
  };
}

function responseData(value: unknown): Array<{ embedding?: unknown }> {
  if (!value || typeof value !== "object" || !("data" in value)) return [];
  const data = value.data;
  return Array.isArray(data)
    ? data.map((item) =>
        item && typeof item === "object" ? (item as { embedding?: unknown }) : {},
      )
    : [];
}
