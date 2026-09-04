import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/macos/**/*.test.ts"], passWithNoTests: true },
});
