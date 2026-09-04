import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "fixtures/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
