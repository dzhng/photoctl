import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { hasCode } from "./fs-errors.js";

export interface ModelManifest {
  schema: 1;
  source: { repository: string; revision: string };
  artifacts: Array<{ file: string; sha256: string; opset: number }>;
}

export interface ModelFetchResult {
  file: string;
  sha256: string;
  cached: boolean;
}

export async function fetchPinnedModels(options: {
  manifest: ModelManifest;
  baseUrl: string;
  directory: string;
  fetch?: typeof fetch;
}): Promise<ModelFetchResult[]> {
  assertManifest(options.manifest);
  const baseUrl = new URL(options.baseUrl);
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
    throw new Error("Model base URL must use HTTP or HTTPS");
  }
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  await mkdir(options.directory, { recursive: true });
  const request = options.fetch ?? fetch;
  return await Promise.all(
    options.manifest.artifacts.map(async (artifact) => {
      const destination = join(options.directory, artifact.file);
      if ((await fileHash(destination)) === artifact.sha256) {
        return { file: artifact.file, sha256: artifact.sha256, cached: true };
      }
      const response = await request(new URL(artifact.file, baseUrl));
      if (!response.ok) {
        throw new Error(`Model download failed for ${artifact.file}: HTTP ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const actual = sha256(bytes);
      if (actual !== artifact.sha256) {
        throw new Error(
          `SHA-256 mismatch for ${artifact.file}: expected ${artifact.sha256}, received ${actual}`,
        );
      }
      const temporary = join(options.directory, `.${artifact.file}.${randomUUID()}.tmp`);
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
      return { file: artifact.file, sha256: artifact.sha256, cached: false };
    }),
  );
}

export async function inspectPinnedModels(
  manifest: ModelManifest,
  directory: string,
): Promise<Array<ModelFetchResult & { opset: number }>> {
  assertManifest(manifest);
  return await Promise.all(
    manifest.artifacts.map(async (artifact) => ({
      ...artifact,
      cached: (await fileHash(join(directory, artifact.file))) === artifact.sha256,
    })),
  );
}

export function parseModelReleaseManifest(value: unknown): ModelManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid model release manifest");
  }
  const candidate = value as Partial<ModelManifest>;
  if (
    candidate.schema !== 1 ||
    typeof candidate.source !== "object" ||
    candidate.source === null ||
    typeof candidate.source.repository !== "string" ||
    candidate.source.repository.length === 0 ||
    typeof candidate.source.revision !== "string" ||
    !Array.isArray(candidate.artifacts) ||
    candidate.artifacts.some(
      (artifact) =>
        typeof artifact !== "object" ||
        artifact === null ||
        typeof artifact.file !== "string" ||
        typeof artifact.sha256 !== "string" ||
        typeof artifact.opset !== "number",
    )
  ) {
    throw new Error("Invalid model release manifest");
  }
  const manifest = candidate as ModelManifest;
  assertManifest(manifest);
  return manifest;
}

function assertManifest(manifest: ModelManifest): void {
  if (manifest.schema !== 1 || !/^[0-9a-f]{40}$/u.test(manifest.source.revision)) {
    throw new Error("Invalid pinned model manifest source");
  }
  if (manifest.artifacts.length === 0) throw new Error("Pinned model manifest has no artifacts");
  const files = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (
      artifact.file !== basename(artifact.file) ||
      !artifact.file.endsWith(".onnx") ||
      !/^[0-9a-f]{64}$/u.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.opset) ||
      artifact.opset <= 0 ||
      files.has(artifact.file)
    ) {
      throw new Error(`Invalid pinned model artifact: ${artifact.file}`);
    }
    files.add(artifact.file);
  }
}

async function fileHash(path: string): Promise<string | null> {
  try {
    return sha256(await readFile(path));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
