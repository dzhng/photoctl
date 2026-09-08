/** True when `error` is an Error carrying the errno-style `code` (ENOENT, EEXIST, EAGAIN, ...). */
export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
