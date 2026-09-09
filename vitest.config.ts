import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // Each file can spawn real CLI/native work; CPU-count forks oversubscribe those nested jobs.
    maxWorkers: 2,
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "fixtures/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
