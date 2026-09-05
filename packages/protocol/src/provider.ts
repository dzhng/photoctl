import { z } from "zod";

export const MAX_PROVIDER_MODEL_ID_BYTES = 256;

export const providerModelIdSchema = z
  .string()
  .min(1)
  .refine(
    (model) => new TextEncoder().encode(model).byteLength <= MAX_PROVIDER_MODEL_ID_BYTES,
    `Provider model ids must be at most ${MAX_PROVIDER_MODEL_ID_BYTES} bytes`,
  );
