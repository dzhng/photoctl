export class InvalidXmpError extends Error {}

export class XmpChangedError extends Error {}

export class XmpFilesystemError extends Error {
  readonly code: string | undefined;

  constructor(operation: string, path: string, cause: unknown) {
    super(
      `Unable to ${operation} XMP sidecar ${path}${errorCode(cause) ? ` (${errorCode(cause)})` : ""}`,
      {
        cause,
      },
    );
    this.code = errorCode(cause);
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") {
    return undefined;
  }
  return error.code;
}
