import { PhotoctlError } from "@photoctl/protocol";

export function parseByteSize(value: string, allowZero = false): number {
  const match = /^(\d+(?:\.\d+)?)(B|KiB|MiB|GiB|TiB)$/i.exec(value);
  if (!match) throw new PhotoctlError("usage", `Invalid byte size: ${value}`);
  const units = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
  const bytes = Number(match[1]) * units[match[2].toLowerCase() as keyof typeof units];
  if (!Number.isSafeInteger(bytes) || bytes < 0 || (!allowZero && bytes === 0)) {
    throw new PhotoctlError("usage", `Invalid byte size: ${value}`);
  }
  return bytes;
}
