import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type Envelope, type ErrorCode, type Warning } from "@photoctl/protocol";

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

export function batchEnvelope<T extends { id: string; ok: boolean }>(
  results: T[],
  warnings: Warning[] = [],
): Envelope {
  const failures = results.filter((item) => !item.ok) as Array<T & BatchFailure>;
  if (failures.length === 0) {
    return {
      schema: 1,
      ok: true,
      summary: { ok: results.length, failed: 0 },
      results,
      warnings,
    };
  }
  return {
    schema: 1,
    ok: false,
    code: batchFailureCode(
      failures.map((failure) => failure.code),
      results.length - failures.length,
    ),
    summary: { ok: results.length - failures.length, failed: failures.length },
    results,
    warnings,
  };
}

export function batchFailure(id: string, error: unknown): BatchFailure {
  if (!(error instanceof PhotoctlError)) throw error;
  return { ...errorData(error.data), id, ok: false, code: error.code };
}

/** All-failed batches with one code keep it; any success or mixed codes are `partial`. */
export function batchFailureCode(codes: Iterable<ErrorCode>, succeeded: number): ErrorCode {
  const distinct = new Set(codes);
  return succeeded === 0 && distinct.size === 1 ? [...distinct][0] : "partial";
}

export function errorData(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}
