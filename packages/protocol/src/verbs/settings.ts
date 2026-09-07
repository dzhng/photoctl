import { z } from "zod";
import { providerModelIdSchema } from "../provider.js";

export const concreteModelIdSchema = providerModelIdSchema.refine(
  (model) => model !== "auto" && model !== "latest" && !model.endsWith("/latest"),
  "Provider selection requires a concrete model id",
);

const modelSettingsSchema = z.object({
  edit: concreteModelIdSchema.optional(),
  generate: concreteModelIdSchema.optional(),
  structured: concreteModelIdSchema.optional(),
  embed: concreteModelIdSchema.optional(),
  upscale: concreteModelIdSchema.optional(),
});
const generationSettingsSchema = z.object({ upscale: z.enum(["auto", "off"]).default("auto") });
const upscaleProviderSettingsSchema = z.object({ configured: z.boolean() });
const providerSettingsSchema = z.object({
  upscale: z.record(concreteModelIdSchema, upscaleProviderSettingsSchema).default({}),
});

export const userSettingsSchema = z
  .object({
    models: modelSettingsSchema.strict().default({}),
    generation: generationSettingsSchema.strict().default({ upscale: "auto" }),
    providers: providerSettingsSchema
      .extend({
        upscale: z
          .record(concreteModelIdSchema, upscaleProviderSettingsSchema.strict())
          .default({}),
      })
      .strict()
      .default({ upscale: {} }),
    models_base_url: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
      }, "Model mirrors require an HTTP(S) URL without credentials")
      .nullable()
      .default(null),
    embed_mode: z.enum(["auto", "manual"]).default("manual"),
    cache_max_bytes: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(20 * 1024 ** 3),
  })
  .strict();

export const userSettingKeySchema = userSettingsSchema.keyof();
export type UserSettingKey = z.infer<typeof userSettingKeySchema>;
export type UserSettings = z.infer<typeof userSettingsSchema>;
export const settingsDataSchema = z.object({
  settings: z.object({
    models: modelSettingsSchema.optional(),
    generation: generationSettingsSchema.optional(),
    providers: providerSettingsSchema.optional(),
    models_base_url: userSettingsSchema.shape.models_base_url.removeDefault().optional(),
    embed_mode: userSettingsSchema.shape.embed_mode.removeDefault().optional(),
    cache_max_bytes: userSettingsSchema.shape.cache_max_bytes.removeDefault().optional(),
  }),
});
export type SettingsData = z.infer<typeof settingsDataSchema>;
