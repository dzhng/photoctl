import { concreteModelIdSchema, type UserSettings } from "@photoctl/protocol";

export const DEFAULT_MODELS = {
  edit: "openai/gpt-image-2",
  generate: "openai/gpt-image-2",
  structured: "google/gemini-3-flash",
  embed: "google/gemini-embedding-2",
  upscale: "photoctl/fake-upscale-v1",
} as const satisfies Required<UserSettings["models"]>;

export type ModelPurpose = keyof typeof DEFAULT_MODELS;
export type ResolvedModels = Record<ModelPurpose, string>;

export function resolveModels(overrides: Partial<ResolvedModels> = {}): ResolvedModels {
  const resolved = { ...DEFAULT_MODELS, ...overrides };
  for (const model of Object.values(resolved)) concreteModelIdSchema.parse(model);
  return resolved;
}

export function resolveModel(
  purpose: ModelPurpose,
  overrides: Partial<ResolvedModels> = {},
  commandOverride?: string,
): string {
  const model = commandOverride ?? overrides[purpose] ?? DEFAULT_MODELS[purpose];
  return concreteModelIdSchema.parse(model);
}
