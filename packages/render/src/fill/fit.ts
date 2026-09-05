import { PhotoctlError } from "@photoctl/protocol";
import { effectiveMaskParametersSchema, type FillFit } from "../mask-operations.js";

export function resolveFillFit(
  operation: "remove" | "prompt",
  fit?: string,
  strength?: string,
): FillFit {
  const value = fit ?? (operation === "remove" ? "strict" : "expand=24");
  const expanded = /^(?:expand)(?:=(\d+))?$/.exec(value);
  if (value !== "strict" && value !== "free" && !expanded) {
    throw new PhotoctlError("usage", "--fit requires strict, expand=N, or free");
  }
  const amount = strength === undefined ? undefined : Number(strength);
  if (
    amount !== undefined &&
    (!Number.isFinite(amount) || amount < 0 || amount > 1 || strength?.trim() === "")
  ) {
    throw new PhotoctlError(
      "usage",
      "--strength must be between 0 and 1 (mask feather, not denoise)",
    );
  }
  const parsed = effectiveMaskParametersSchema.safeParse({
    operation: "fit",
    mode: expanded ? "expand" : value,
    expand_px: expanded ? Number(expanded[1] ?? 24) : 0,
    feather_px: amount === undefined ? (value === "free" ? 24 : 0) : Math.round(amount * 64),
  });
  if (!parsed.success)
    throw new PhotoctlError("usage", "Mask expansion must be an integer between 0 and 4096");
  return parsed.data as FillFit;
}
