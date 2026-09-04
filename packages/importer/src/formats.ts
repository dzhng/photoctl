import { extname } from "node:path";

export type ImportFormat =
  | { readonly kind: "raw"; readonly source: "embedded" }
  | { readonly kind: "image"; readonly source: "file" };

const formats = new Map<string, ImportFormat>([
  [".arw", { kind: "raw", source: "embedded" }],
  [".jpg", { kind: "image", source: "file" }],
  [".jpeg", { kind: "image", source: "file" }],
  [".png", { kind: "image", source: "file" }],
  [".tif", { kind: "image", source: "file" }],
  [".tiff", { kind: "image", source: "file" }],
]);

export function classifyFormat(path: string): ImportFormat | undefined {
  return formats.get(extname(path).toLowerCase());
}
