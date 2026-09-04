export const DEFAULT_MODELS = {
  edit: "openai/gpt-image-2",
  generate: "openai/gpt-image-2",
  structured: "google/gemini-3.1-flash",
  embed: "google/gemini-embedding-2",
  upscale: "photoctl/fake-upscale-v1",
} as const;

export type ModelPurpose = keyof typeof DEFAULT_MODELS;
export type ResolvedModels = Record<ModelPurpose, string>;

export function resolveModels(overrides: Partial<ResolvedModels> = {}): ResolvedModels {
  const resolved = { ...DEFAULT_MODELS, ...overrides };
  for (const model of Object.values(resolved)) assertConcreteModel(model);
  return resolved;
}

export function resolveModel(
  purpose: ModelPurpose,
  overrides: Partial<ResolvedModels> = {},
  commandOverride?: string,
): string {
  const model = commandOverride ?? overrides[purpose] ?? DEFAULT_MODELS[purpose];
  assertConcreteModel(model);
  return model;
}

function assertConcreteModel(model: string): void {
  if (model === "auto" || model === "latest" || model.endsWith("/latest")) {
    throw new Error("Provider selection requires a concrete model id");
  }
}
