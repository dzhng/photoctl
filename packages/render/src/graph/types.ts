export const imageNodeKinds = [
  "source",
  "develop",
  "generate",
  "upscale",
  "resample",
  "transform",
  "mask_composite",
  "composite",
  "crop",
  "markup",
  "output",
] as const;

export type ImageNodeKind = (typeof imageNodeKinds)[number];
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface LogicalNodeRecipeInput {
  kind: ImageNodeKind;
  recipeVersion: number;
  parameters: JsonValue;
  inputNodeIds: string[];
}

export interface StoredImageNode {
  id: string;
  photoId: string;
  kind: ImageNodeKind;
  recipeVersion: number;
  parameters: JsonValue;
  recipeHash: string;
}

export interface SourceExecutionProvenance {
  locator:
    | { kind: "online-file"; volume_uuid: string; rel_path: string }
    | {
        kind: "online-jpeg-range";
        volume_uuid: string;
        rel_path: string;
        offset: number;
        length: number;
      }
    | { kind: "pinned-preview"; cache_path: string };
  tier: "online-file" | "online-jpeg-range" | "pinned-preview";
  w: number;
  h: number;
  decoderId: string;
  decoderVersion: string;
}
