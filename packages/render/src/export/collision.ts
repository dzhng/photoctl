import { lstat } from "node:fs/promises";
import { extname } from "node:path";

export type ExportCollisionPolicy = "skip" | "overwrite" | "rename";
export type ExportCollisionResolution = { action: "write" | "skip"; path: string };

export async function resolveExportCollision(
  requestedPath: string,
  policy: ExportCollisionPolicy,
): Promise<ExportCollisionResolution> {
  const existing = await pathKind(requestedPath);
  if (existing === "missing") return { action: "write", path: requestedPath };
  if (existing !== "file")
    throw new Error(`Export destination is not a regular file: ${requestedPath}`);
  if (policy === "skip") return { action: "skip", path: requestedPath };
  if (policy === "overwrite") return { action: "write", path: requestedPath };

  const extension = extname(requestedPath);
  const base = requestedPath.slice(0, requestedPath.length - extension.length);
  return { action: "write", path: await availableRename(base, extension, 2, requestedPath) };
}

async function availableRename(
  base: string,
  extension: string,
  suffix: number,
  requestedPath: string,
): Promise<string> {
  if (!Number.isSafeInteger(suffix))
    throw new Error(`Could not choose a collision-free export path: ${requestedPath}`);
  const candidate = `${base}_${suffix}${extension}`;
  return (await pathKind(candidate)) === "missing"
    ? candidate
    : await availableRename(base, extension, suffix + 1, requestedPath);
}

async function pathKind(path: string): Promise<"missing" | "file" | "other"> {
  try {
    return (await lstat(path)).isFile() ? "file" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}
