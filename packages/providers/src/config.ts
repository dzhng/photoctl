import { providerModelIdSchema } from "@photoctl/protocol";
import { z } from "zod";
import { DEFAULT_GATEWAY_URL } from "./gateway.js";
import { DEFAULT_MODELS, resolveModels, type ResolvedModels } from "./table.js";
import type { UpscaleSettings } from "./upscale/registry.js";

interface SettingsDatabase {
  query<Row>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface ProviderSettings extends UpscaleSettings {
  models: Partial<ResolvedModels>;
  generation: { upscale: "auto" | "off" };
  providers: { upscale: Record<string, { configured: boolean }> };
}

export async function readProviderSettings(database: SettingsDatabase): Promise<ProviderSettings> {
  const result = await database.query<{ key: string; value: unknown }>(
    "SELECT key, value FROM settings WHERE key IN ('models', 'generation', 'providers')",
  );
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  return {
    models: modelOverridesSchema.parse(values.models ?? {}),
    generation: generationSchema.parse(values.generation ?? {}),
    providers: providersSchema.parse(values.providers ?? {}),
  };
}

export function providerDiagnostics(
  settings: ProviderSettings,
  environment: { gatewayApiKey?: string; gatewayUrl?: string },
) {
  const models = resolveModels(settings.models);
  const configuredBase = (environment.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, "");
  const selected = models.upscale;
  return {
    gateway: {
      configured: Boolean(environment.gatewayApiKey),
      base_url: configuredBase.endsWith("/v1") ? configuredBase : `${configuredBase}/v1`,
      models: {
        edit: models.edit,
        generate: models.generate,
        structured: models.structured,
        embed: models.embed,
      },
    },
    upscale: {
      release_default: DEFAULT_MODELS.upscale,
      selected,
      configured: settings.providers.upscale[selected]?.configured === true,
    },
  };
}

const modelOverridesSchema = z
  .object({
    edit: providerModelIdSchema.optional(),
    generate: providerModelIdSchema.optional(),
    structured: providerModelIdSchema.optional(),
    embed: providerModelIdSchema.optional(),
    upscale: providerModelIdSchema.optional(),
  })
  .strip();
const generationSchema = z.object({ upscale: z.enum(["auto", "off"]).default("auto") }).strip();
const providersSchema = z
  .object({
    upscale: z.record(z.string(), z.object({ configured: z.boolean() }).strip()).default({}),
  })
  .strip();
