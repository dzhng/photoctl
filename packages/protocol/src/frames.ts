import type { Envelope } from "./envelope.js";
import type { StderrEvent } from "./events.js";
import type { CommandRequest } from "./request.js";

export type DaemonControlAction = "status" | "stop";

export type DaemonClientFrame =
  | { type: "request"; request: CommandRequest }
  | { type: "control"; action: DaemonControlAction };

export type DaemonServerFrame =
  | { type: "event"; event: StderrEvent }
  | { type: "response"; envelope: Envelope };

export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export class FrameDecoder {
  private bytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  push(chunk: Buffer<ArrayBufferLike>): unknown[] {
    this.bytes = this.bytes.length === 0 ? chunk : Buffer.concat([this.bytes, chunk]);
    const frames: unknown[] = [];
    while (this.bytes.length >= 4) {
      const length = this.bytes.readUInt32BE(0);
      if (length > 16 * 1024 * 1024) throw new Error("Daemon frame exceeds 16 MiB");
      if (this.bytes.length < 4 + length) break;
      frames.push(JSON.parse(this.bytes.subarray(4, 4 + length).toString("utf8")));
      this.bytes = this.bytes.subarray(4 + length);
    }
    return frames;
  }
}
