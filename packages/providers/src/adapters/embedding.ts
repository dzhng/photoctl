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

export const EMBED_IMAGE_REQUEST_SHAPE = "gateway-google-content-v1";

export function createEmbeddingAdapter(options: {
  model: string;
  request(body: Record<string, unknown>, signal?: AbortSignal): Promise<GatewayResponse<unknown>>;
  requestImages(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<GatewayResponse<unknown>>;
}): EmbeddingAdapter {
  const validate = (
    response: GatewayResponse<unknown>,
    count: number,
    data: Array<{ embedding?: unknown }>,
  ): EmbeddingResult => {
    const dimensions = data.map((item) =>
      Array.isArray(item.embedding) ? item.embedding.length : null,
    );
    if (
      data.length !== count ||
      data.some(
        (item) =>
          !Array.isArray(item.embedding) ||
          item.embedding.length !== 3_072 ||
          !item.embedding.every((value) => typeof value === "number" && Number.isFinite(value)),
      )
    ) {
      throw new PhotoctlError("provider_busy", "The provider returned invalid embeddings", {
        expected_count: count,
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
    text: async (inputs, signal) => {
      const response = await options.request(
        { model: options.model, dimensions: 3_072, input: [...inputs] },
        signal,
      );
      return validate(response, inputs.length, responseData(response.data));
    },
    images: async (inputs, signal) => {
      if (options.model !== "google/gemini-embedding-2") {
        throw new PhotoctlError(
          "provider_unconfigured",
          "Image embeddings require the verified google/gemini-embedding-2 content adapter; text-only models cannot index images",
        );
      }
      const response = await options.requestImages(
        {
          model: options.model,
          values: inputs.map(() => "A photograph indexed for cross-modal retrieval."),
          providerOptions: {
            google: {
              outputDimensionality: 3_072,
              content: inputs.map((jpeg) => [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: Buffer.from(jpeg).toString("base64"),
                  },
                },
              ]),
            },
          },
        },
        signal,
      );
      const data = response.data;
      const vectors =
        data && typeof data === "object" && "embeddings" in data ? data.embeddings : undefined;
      return validate(
        response,
        inputs.length,
        Array.isArray(vectors) ? vectors.map((embedding) => ({ embedding })) : [],
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
