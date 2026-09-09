import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  inspectPinnedModels,
  parseModelReleaseManifest,
  copyModelNotices,
  PINNED_MODEL_RELEASE,
} from "../packages/library/dist/index.js";

const [directory, manifestPath] = process.argv.slice(2);
if (!directory) throw new Error("usage: verify-release-models.mjs DIRECTORY [MANIFEST]");
const manifestText = manifestPath
  ? await readFile(manifestPath, "utf8")
  : `${JSON.stringify(PINNED_MODEL_RELEASE, null, 2)}\n`;
const manifest = parseModelReleaseManifest(JSON.parse(manifestText));
const results = await inspectPinnedModels(manifest, resolve(directory));
const invalid = results.filter((result) => !result.cached);
if (invalid.length)
  throw new Error(
    `Missing or mismatched release models: ${invalid.map((result) => result.file).join(", ")}`,
  );
await writeFile(join(directory, "models.json"), manifestText);
await copyModelNotices(directory);
await writeFile(
  join(directory, "SHA256SUMS"),
  results.map((result) => `${result.sha256}  ${result.file}\n`).join(""),
);
console.log(
  `Verified ${results.length} release models against ${manifest.source.repository}@${manifest.source.revision}`,
);
