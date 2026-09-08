import { XmpFilesystemError } from "./errors.js";

/** Run one sidecar filesystem step, naming the operation and path in any failure. */
export async function filesystem<T>(
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
