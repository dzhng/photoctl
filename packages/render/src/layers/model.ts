import type { NodeReference } from "../graph/store.js";
import { PhotoctlError } from "@photoctl/protocol";

export const layerRoles = ["subject", "vacancy", "reimagine", "retouch"] as const;
export type LayerRole = (typeof layerRoles)[number];
export type LayerReference = { layerId: string } | { localKey: string };

export interface NewLayerIdentity {
  localKey: string;
  role: LayerRole;
  ofLayer?: LayerReference | null;
}

export interface RevisionLayerDraft {
  layer: LayerReference;
  name: string;
  z: number;
  contentNode: NodeReference;
  maskNode: NodeReference;
  opacity: number;
  blend: "normal";
  enabled: boolean;
}

export interface RevisionLayer {
  id: string;
  role: LayerRole;
  ofLayer: string | null;
  name: string;
  z: number;
  contentNodeId: string;
  maskNodeId: string;
  opacity: number;
  blend: "normal";
  enabled: boolean;
}

export async function resolveLayerId(
  database: { query<Row>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }> },
  photoId: string,
  input: string,
): Promise<string> {
  if (!/^[0-9a-f-]{1,36}$/i.test(input)) {
    throw new PhotoctlError("usage", `Invalid layer ID or prefix: ${input}`);
  }
  const matches = await database.query<{ id: string }>(
    `SELECT id::text FROM layers
     WHERE photo_id = $1 AND id::text LIKE $2 ORDER BY id LIMIT 2`,
    [photoId, `${input.toLowerCase()}%`],
  );
  const id = matches.rows[0]?.id;
  if (!id) throw new PhotoctlError("not_found", `Layer not found: ${input}`, { id: input });
  if (matches.rows.length > 1) {
    throw new PhotoctlError("not_found", `Layer ID prefix is ambiguous: ${input}`, {
      id: input,
      reason: "ambiguous",
    });
  }
  return id;
}

export function compositeV2Projection<Reference = NodeReference>(
  base: Reference,
  layers: readonly {
    contentNode: Reference;
    maskNode: Reference;
    opacity: number;
    blend: "normal";
    enabled: boolean;
  }[],
): { parameters: { layers: Array<{ opacity: number; blend: "normal" }> }; inputs: Reference[] } {
  const enabled = layers.filter((layer) => layer.enabled);
  return {
    parameters: {
      layers: enabled.map(({ opacity, blend }) => ({ opacity, blend })),
    },
    inputs: [base, ...enabled.flatMap(({ contentNode, maskNode }) => [contentNode, maskNode])],
  };
}
