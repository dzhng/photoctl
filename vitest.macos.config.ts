import { defineConfig, mergeConfig } from "vitest/config";
import models from "./vitest.models.config.js";

export default mergeConfig(
  models,
  defineConfig({
    test: { include: ["test/macos/**/*.test.ts"] },
  }),
);
