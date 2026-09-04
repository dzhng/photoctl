import { randomUUID } from "node:crypto";
import { link, rename, rm } from "node:fs/promises";
import { XmpChangedError, XmpFilesystemError } from "./errors.js";
import { readFileSnapshot } from "./snapshot.js";

export async function publishXmpSnapshot(
  path: string,
  temporary: string,
  expectedIdentity: string | undefined,
): Promise<boolean> {
  if (expectedIdentity === undefined) return await installWithoutClobber(temporary, path);

  const displaced = `${path}.photoctl-${randomUUID()}.previous`;
  try {
    await rename(path, displaced);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw new XmpFilesystemError("preserve current", path, error);
  }

  let needsRestore = true;
  try {
    const captured = await readFileSnapshot(displaced);
    if (!captured) {
      needsRestore = false;
      throw new XmpChangedError(`Displaced XMP sidecar disappeared during publication: ${path}`);
    }
    if (captured.identity !== expectedIdentity) {
      await restoreDisplaced(displaced, path);
      needsRestore = false;
      return false;
    }

    if (!(await installWithoutClobber(temporary, path))) {
      await filesystem(
        "discard superseded",
        displaced,
        async () => await rm(displaced, { force: true }),
      );
      needsRestore = false;
      return false;
    }
    await filesystem(
      "discard preserved",
      displaced,
      async () => await rm(displaced, { force: true }),
    );
    needsRestore = false;
    return true;
  } catch (error) {
    if (!needsRestore) throw error;
    try {
      await restoreDisplaced(displaced, path);
    } catch (restoreError) {
      throw new XmpChangedError(
        `XMP publication conflicted; preserved displaced bytes at ${displaced}`,
        { cause: restoreError },
      );
    }
    throw error;
  }
}

async function installWithoutClobber(temporary: string, path: string): Promise<boolean> {
  try {
    await link(temporary, path);
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false;
    throw new XmpFilesystemError("publish", path, error);
  }
  await filesystem(
    "remove temporary link for",
    path,
    async () => await rm(temporary, { force: true }),
  );
  return true;
}

async function restoreDisplaced(displaced: string, path: string): Promise<void> {
  try {
    await link(displaced, path);
  } catch (error) {
    if (hasCode(error, "EEXIST")) {
      throw new XmpChangedError(
        `XMP changed again during conflict recovery; preserved displaced bytes at ${displaced}`,
        { cause: error },
      );
    }
    throw new XmpFilesystemError("restore", path, error);
  }
  await filesystem(
    "remove recovery link for",
    path,
    async () => await rm(displaced, { force: true }),
  );
}

async function filesystem<T>(
  operation: string,
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new XmpFilesystemError(operation, path, error);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
