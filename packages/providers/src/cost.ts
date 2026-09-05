import type { Warning } from "@photoctl/protocol";

const EMBEDDING_USD_PER_IMAGE: Readonly<Record<string, number>> = {
  "google/gemini-embedding-2": 0.9 / 2_000,
};

export function estimateEmbeddingCost(
  model: string,
  images: number,
): { usd: number; warning?: Warning } {
  if (!Number.isSafeInteger(images) || images < 0) {
    throw new Error("Embedding image count must be a non-negative integer");
  }
  const perImage = EMBEDDING_USD_PER_IMAGE[model];
  if (perImage === undefined) {
    return {
      usd: 0,
      warning: {
        code: "provider_warning",
        message: `Pricing is not available for ${model}; estimated embedding cost is a placeholder`,
      },
    };
  }
  return { usd: Number((images * perImage).toFixed(6)) };
}

export function estimateProviderCost(
  model: string,
  usage: { inputPx: number; outputPx: number },
): { usd: number; warning: Warning } {
  if (
    !Number.isSafeInteger(usage.inputPx) ||
    usage.inputPx < 0 ||
    !Number.isSafeInteger(usage.outputPx) ||
    usage.outputPx < 0
  ) {
    throw new Error("Provider pixel counts must be non-negative integers");
  }
  return {
    usd: 0,
    warning: {
      code: "provider_warning",
      message: `Pricing is not available for ${model}; estimated cost is a placeholder`,
    },
  };
}
