import { userSettingsSchema, type UserSettings } from "@photoctl/protocol";
import { DEFAULT_GATEWAY_URL } from "./gateway.js";
import { DEFAULT_MODELS, resolveModels } from "./table.js";

interface SettingsDatabase {
  query<Row>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}

export type ProviderSettings = Pick<UserSettings, "models" | "generation" | "providers">;

export async function readProviderSettings(database: SettingsDatabase): Promise<ProviderSettings> {
  const result = await database.query<{ key: string; value: unknown }>(
    "SELECT key, value FROM settings WHERE key IN ('models', 'generation', 'providers')",
  );
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  return {
    models: userSettingsSchema.shape.models.parse(values.models),
    generation: userSettingsSchema.shape.generation.parse(values.generation),
    providers: userSettingsSchema.shape.providers.parse(values.providers),
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
