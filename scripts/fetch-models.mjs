import {
  completeModelManifest,
  fetchPinnedModels,
  parseModelReleaseManifest,
} from "../packages/library/dist/index.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const [baseUrl, directory, manifestPath = "fixtures/models.json"] = process.argv.slice(2);
if (!baseUrl || !directory) {
  throw new Error("usage: fetch-models.mjs BASE_URL DIRECTORY [MANIFEST]");
}
const release = parseModelReleaseManifest(
  JSON.parse(await readFile(resolve(manifestPath), "utf8")),
);
const manifest = completeModelManifest(release);
if (!manifest) {
  throw new Error("model manifest is awaiting a real export; refusing an unpinned Docker build");
}
const results = await fetchPinnedModels({
  manifest,
  baseUrl,
  directory: resolve(directory),
});
for (const result of results)
  console.log(`${result.cached ? "cached" : "fetched"} ${result.file} ${result.sha256}`);
