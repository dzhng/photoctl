import type { Warning } from "@photoctl/protocol";

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
