import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type Envelope, type ErrorCode } from "@photoctl/protocol";

export interface BatchFailure {
  id: string;
  ok: false;
  code: ErrorCode;
  [key: string]: unknown;
}

export async function resolveBatchInputs(
  handle: LibraryHandle,
  inputs: string[],
): Promise<Array<{ id: string; ok: true } | BatchFailure>> {
  return await Promise.all(
    inputs.map(async (input) => {
      try {
        return { id: await resolvePhotoId(handle, input), ok: true } as const;
      } catch (error) {
        if (!(error instanceof PhotoctlError)) throw error;
        return { ...errorData(error.data), id: input, ok: false, code: error.code } as const;
      }
    }),
  );
}

export function batchEnvelope<T extends { id: string; ok: boolean }>(results: T[]): Envelope {
  const failures = results.filter((item) => !item.ok) as Array<T & BatchFailure>;
  if (failures.length === 0) {
    return {
      schema: 1,
      ok: true,
      summary: { ok: results.length, failed: 0 },
      results,
      warnings: [],
    };
  }
  const codes = new Set(failures.map((failure) => failure.code));
  return {
    schema: 1,
    ok: false,
    code:
      failures.length < results.length
        ? "partial"
        : codes.size === 1
          ? failures[0].code
          : "partial",
    summary: { ok: results.length - failures.length, failed: failures.length },
    results,
    warnings: [],
  };
}

export function batchFailure(id: string, error: unknown): BatchFailure {
  if (!(error instanceof PhotoctlError)) throw error;
  return { ...errorData(error.data), id, ok: false, code: error.code };
}

function errorData(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}
