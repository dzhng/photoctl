import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  completeModelManifest,
  inspectPinnedModels,
  parseModelReleaseManifest,
} from "../packages/library/dist/index.js";

const [directory, manifestPath = "fixtures/models.json"] = process.argv.slice(2);
if (!directory) throw new Error("usage: verify-release-models.mjs DIRECTORY [MANIFEST]");
const manifest = completeModelManifest(
  parseModelReleaseManifest(JSON.parse(await readFile(manifestPath, "utf8"))),
);
if (!manifest) throw new Error("Release models must have committed hashes");
const results = await inspectPinnedModels(manifest, resolve(directory));
const invalid = results.filter((result) => !result.cached);
if (invalid.length)
  throw new Error(
    `Missing or mismatched release models: ${invalid.map((result) => result.file).join(", ")}`,
  );
await copyFile(manifestPath, join(directory, "models.json"));
await writeFile(
  join(directory, "SHA256SUMS"),
  results.map((result) => `${result.sha256}  ${result.file}\n`).join(""),
);
console.log(`Verified ${results.length} release models against ${manifestPath}`);
