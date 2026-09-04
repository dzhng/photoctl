export const errorCodes = [
  "usage",
  "not_found",
  "partial",
  "unsupported_file",
  "library_locked",
  "daemon_unavailable",
  "file_offline",
  "volume_readonly",
  "catalog_unreadable",
  "migrate_required",
  "decoder_unavailable",
  "provider_unconfigured",
  "provider_unverified_mask",
  "provider_whole_frame",
  "provider_busy",
] as const;
export type ErrorCode = (typeof errorCodes)[number];
export const warningCodes = [
  "source_offline",
  "layers_stale",
  "vacancy_unfilled",
  "provider_unconfigured",
  "provider_warning",
  "xmp_stale",
  "label_unknown",
] as const;
export type WarningCode = (typeof warningCodes)[number];
export interface Warning {
  code: WarningCode;
  id?: string;
  message: string;
}
export type Envelope<T = unknown> =
  | { schema: 1; ok: true; data: T; warnings: Warning[] }
  | {
      schema: 1;
      ok: true;
      summary: { ok: number; failed: number };
      results: unknown[];
      warnings: Warning[];
    }
  | {
      schema: 1;
      ok: false;
      code: ErrorCode;
      data?: unknown;
      summary?: { ok: number; failed: number };
      results?: unknown[];
      warnings?: Warning[];
    };
const exitCodes: Record<ErrorCode, number> = {
  usage: 2,
  not_found: 65,
  partial: 65,
  unsupported_file: 65,
  provider_whole_frame: 65,
  daemon_unavailable: 69,
  file_offline: 69,
  volume_readonly: 69,
  catalog_unreadable: 69,
  migrate_required: 69,
  decoder_unavailable: 69,
  provider_unconfigured: 69,
  provider_unverified_mask: 69,
  library_locked: 75,
  provider_busy: 75,
};
export function exitCodeFor(code: ErrorCode): number {
  return exitCodes[code];
}
export class PhotoctlError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}
