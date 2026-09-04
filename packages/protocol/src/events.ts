import type { WarningCode } from "./envelope.js";
export type ProgressEvent = {
  event: "progress";
  phase: string;
  done: number;
  total: number;
  per_sec?: number;
  eta_s?: number;
};
export type DaemonEvent = {
  event: "daemon";
  action: string;
  pid: number;
  socket: string;
  version: string;
  schema: number;
};
export type ProviderEvent = {
  event: "provider";
  gateway: string;
  model: string;
  op: string;
  mask: boolean;
  sent_px: number;
  format: string;
};
export type WarnEvent = { event: "warn"; code: WarningCode; id?: string; message: string };
export type StderrEvent = ProgressEvent | DaemonEvent | ProviderEvent | WarnEvent;
