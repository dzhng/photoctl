import { PhotoctlError } from "@photoctl/protocol";

export function hasErrorCode(error: unknown, code: string): error is Error & { code: string } {
  return error instanceof Error && "code" in error && error.code === code;
}

export function sourceReadError(error: unknown, path: string): PhotoctlError {
  if (hasErrorCode(error, "ENOENT")) {
    return new PhotoctlError("not_found", `File not found: ${path}`, { path });
  }
  if (["EACCES", "EPERM", "EIO", "ESTALE"].some((code) => hasErrorCode(error, code))) {
    return new PhotoctlError("file_offline", `Source cannot be read: ${path}`, { path });
  }
  return new PhotoctlError("unsupported_file", `Cannot read supported file: ${path}`, { path });
}

export function sourceChangedError(path: string): PhotoctlError {
  return new PhotoctlError("unsupported_file", `File changed during import: ${path}`, {
    path,
    reason: "changed_during_import",
  });
}

export function cacheWriteError(path: string): PhotoctlError {
  return new PhotoctlError("volume_readonly", `Cannot write pinned preview cache: ${path}`, {
    path,
  });
}
