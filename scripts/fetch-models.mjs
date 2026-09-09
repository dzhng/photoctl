import {
  fetchPinnedModels,
  parseModelReleaseManifest,
  modelSourceBaseUrl,
  PINNED_MODEL_RELEASE,
} from "../packages/library/dist/index.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "base-url": { type: "string" },
    manifest: { type: "string" },
  },
});
if (positionals.length !== 1) {
  throw new Error("usage: fetch-models.mjs DIRECTORY [--base-url URL] [--manifest PATH]");
}
const manifest = values.manifest
  ? parseModelReleaseManifest(JSON.parse(await readFile(resolve(values.manifest), "utf8")))
  : PINNED_MODEL_RELEASE;
const results = await fetchPinnedModels({
  manifest,
  baseUrl: values["base-url"] ?? modelSourceBaseUrl(manifest),
  directory: resolve(positionals[0]),
});
for (const result of results)
  console.log(`${result.cached ? "cached" : "fetched"} ${result.file} ${result.sha256}`);
