import { DEFAULT_MODELS } from "../table.js";
import { FakeUpscaleAdapter } from "./fake.js";
import { UpscaleRegistry } from "./registry.js";

export function createUpscaleRegistry(): UpscaleRegistry {
  const registry = new UpscaleRegistry(DEFAULT_MODELS.upscale);
  registry.register(new FakeUpscaleAdapter());
  return registry;
}
