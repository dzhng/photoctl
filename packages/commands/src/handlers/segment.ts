import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import {
  createManualLayer,
  createMaskLayers,
  orientedDimensions,
  RevisionConflictError,
  summarizeMask,
  type ManualMaskShape,
  type MaskImage,
} from "@photoctl/render";
import {
  groundedInstancesSchema,
  type StructuredImage,
  type StructuredModelAdapter,
} from "@photoctl/providers";
import { PhotoctlError, type Envelope } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";

/* eslint-disable no-await-in-loop -- SAM decoder prompts stay ordered and bound peak mask memory. */

export interface SegmentationAdapter {
  segment(request: {
    photoId: string;
    dimensions: { w: number; h: number };
    points: Array<[number, number]>;
    box?: [number, number, number, number];
  }): Promise<MaskImage>;
}

export interface SegmentationDependencies {
  local: SegmentationAdapter;
  structured?: StructuredModelAdapter;
  image?: StructuredImage;
}

export async function segmentCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  dependencies?: SegmentationDependencies,
): Promise<Envelope> {
  const parsed = parseSegmentArguments(args);
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const photoId = await resolvePhotoId(lease.handle, parsed.id);
    const photo = await loadPhoto(lease.handle, photoId);
    const dimensions = orientedDimensions({ w: photo.w, h: photo.h }, photo.orientation);
    try {
      if (parsed.mode === "manual") {
        const shape = parseManualShape(parsed, dimensions);
        if (parsed.dryRun) {
          throw new PhotoctlError("usage", "--dry-run requires --at or --text");
        }
        const result = await createManualLayer(lease.handle, lease.handle.path, {
          photoId,
          orientation: photo.orientation,
          dimensions,
          shape,
        });
        return manualEnvelope(photoId, result);
      }

      if (!dependencies?.local) {
        throw new PhotoctlError(
          "provider_unconfigured",
          "SAM segmentation runtime is not configured for this command process",
          { id: photoId },
        );
      }
      const points = parsed.at.map((value) => parsePoint(value, parsed.normalized, dimensions));
      const explicitBox = parsed.box
        ? parseBox(parsed.box, parsed.normalized, dimensions)
        : undefined;
      let gatewayCalls = 0;
      let candidates: Array<{ label: string; box?: [number, number, number, number] }>;
      if (parsed.text !== undefined) {
        if (!dependencies.structured || !dependencies.image) {
          throw new PhotoctlError(
            "provider_unconfigured",
            "Text segmentation requires a structured model adapter and image",
            { id: photoId },
          );
        }
        const answer = await dependencies.structured.ask(
          groundedInstancesSchema,
          [dependencies.image],
          `Locate every instance matching this selection: ${parsed.text}`,
        );
        gatewayCalls = 1;
        candidates = answer.value.instances.map((instance) => ({
          label: instance.label,
          box: instance.box_2d,
        }));
      } else {
        candidates = [{ label: "Segment", ...(explicitBox ? { box: explicitBox } : {}) }];
      }
      const masks: Array<{ label: string; mask: MaskImage }> = [];
      for (const candidate of candidates) {
        masks.push({
          label: candidate.label,
          mask: await dependencies.local.segment({
            photoId,
            dimensions,
            points,
            box: candidate.box ?? explicitBox,
          }),
        });
      }
      const summaries = masks.map(({ mask }) => {
        if (mask.w !== dimensions.w || mask.h !== dimensions.h) {
          throw new Error("Mask must use oriented base-image dimensions");
        }
        return summarizeMask(mask);
      });
      if (masks.length === 0) {
        return instanceEnvelope(photoId, gatewayCalls, masks, summaries, null);
      }
      if (parsed.dryRun) {
        return instanceEnvelope(photoId, gatewayCalls, masks, summaries, null);
      }
      const committed = await createMaskLayers(lease.handle, lease.handle.path, {
        photoId,
        orientation: photo.orientation,
        layers: masks.map(({ label, mask }) => ({ name: label, mask })),
      });
      return instanceEnvelope(photoId, gatewayCalls, masks, summaries, committed);
    } catch (error) {
      if (error instanceof PhotoctlError) throw error;
      if (error instanceof RevisionConflictError) {
        throw new PhotoctlError("library_locked", error.message, {
          id: photoId,
          reason: "revision_conflict",
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.startsWith("Segment") ||
        message.startsWith("Manual mask") ||
        message.startsWith("Mask") ||
        message.startsWith("--")
      ) {
        throw new PhotoctlError("usage", message, { id: photoId });
      }
      throw new PhotoctlError("catalog_unreadable", "Could not create segment layers", {
        id: photoId,
        reason: message,
      });
    }
  } finally {
    await lease.release();
  }
}

interface ParsedSegment {
  id: string;
  mode: "manual" | "sam";
  at: string[];
  box?: string;
  brush?: string;
  text?: string;
  normalized: boolean;
  dryRun: boolean;
}

function parseSegmentArguments(args: string[]): ParsedSegment {
  const parsed = parseArguments(args, {
    flags: ["--norm", "--dry-run"],
    options: ["--box", "--brush", "--text"],
    repeatableOptions: ["--at"],
  });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "segment requires one photo ID or prefix");
  }
  const at = parsed.optionValues.get("--at") ?? [];
  const box = parsed.options.get("--box");
  const brush = parsed.options.get("--brush");
  const text = parsed.options.get("--text");
  if (brush && (box || at.length > 0 || text !== undefined)) {
    throw new PhotoctlError("usage", "--brush cannot be combined with SAM prompts");
  }
  if (text !== undefined && box) {
    throw new PhotoctlError("usage", "--text cannot be combined with --box");
  }
  if (!brush && !box && at.length === 0 && text === undefined) {
    throw new PhotoctlError("usage", "segment requires --at, --box, --brush, or --text");
  }
  return {
    id: parsed.positionals[0]!,
    mode: brush || (box && at.length === 0 && text === undefined) ? "manual" : "sam",
    at,
    ...(box ? { box } : {}),
    ...(brush ? { brush } : {}),
    ...(text !== undefined ? { text } : {}),
    normalized: parsed.flags.has("--norm"),
    dryRun: parsed.flags.has("--dry-run"),
  };
}

function parseManualShape(
  parsed: ParsedSegment,
  dimensions: { w: number; h: number },
): ManualMaskShape {
  if (parsed.box) return { kind: "box", bbox: parseBox(parsed.box, parsed.normalized, dimensions) };
  let value: unknown;
  try {
    value = JSON.parse(parsed.brush!);
  } catch {
    throw new Error("--brush must be a JSON array of [x,y] points");
  }
  if (!Array.isArray(value)) throw new Error("--brush must be a JSON array of [x,y] points");
  return {
    kind: "brush",
    points: value.map((point) => {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        point.some((item) => typeof item !== "number")
      ) {
        throw new Error("--brush must be a JSON array of [x,y] points");
      }
      return parseCoordinates(point as [number, number], parsed.normalized, dimensions);
    }),
  };
}

function parsePoint(
  value: string,
  normalized: boolean,
  dimensions: { w: number; h: number },
): [number, number] {
  const coordinates = value.split(",").map(Number);
  if (coordinates.length !== 2 || coordinates.some((item) => !Number.isFinite(item))) {
    throw new Error("--at must be x,y");
  }
  const point = parseCoordinates(coordinates as [number, number], normalized, dimensions);
  if (point[0] < 0 || point[1] < 0 || point[0] >= dimensions.w || point[1] >= dimensions.h) {
    throw new Error("--at coordinates must be inside the oriented base image");
  }
  return point;
}

function parseBox(
  value: string,
  normalized: boolean,
  dimensions: { w: number; h: number },
): [number, number, number, number] {
  const coordinates = value.split(",").map(Number);
  if (coordinates.length !== 4 || coordinates.some((item) => !Number.isFinite(item))) {
    throw new Error("--box must be x,y,w,h");
  }
  assertNormalized(coordinates, normalized);
  const box = coordinates as [number, number, number, number];
  if (box[2] <= 0 || box[3] <= 0) throw new Error("--box must have positive width and height");
  return normalized
    ? [box[0] * dimensions.w, box[1] * dimensions.h, box[2] * dimensions.w, box[3] * dimensions.h]
    : box;
}

function parseCoordinates(
  values: [number, number],
  normalized: boolean,
  dimensions: { w: number; h: number },
): [number, number] {
  assertNormalized(values, normalized);
  return normalized ? [values[0] * dimensions.w, values[1] * dimensions.h] : values;
}

function assertNormalized(values: number[], normalized: boolean): void {
  if (normalized && values.some((value) => value < 0 || value > 1)) {
    throw new Error("--norm coordinates must be between 0 and 1");
  }
}

function manualEnvelope(
  photoId: string,
  result: Awaited<ReturnType<typeof createManualLayer>>,
): Envelope {
  return {
    schema: 1,
    ok: true,
    data: {
      id: photoId,
      layer_id: result.layerId,
      revision_id: result.revisionId,
      render_hash: result.renderHash,
      mask: { artifact_hash: result.artifactHash, bbox: result.bbox, pixels: result.pixels },
    },
    warnings: [],
  };
}

function instanceEnvelope(
  photoId: string,
  gatewayCalls: number,
  masks: Array<{ label: string; mask: MaskImage }>,
  summaries: Array<{ bbox: [number, number, number, number]; pixels: number }>,
  committed: Awaited<ReturnType<typeof createMaskLayers>> | null,
): Envelope {
  return {
    schema: 1,
    ok: true,
    data: {
      id: photoId,
      revision_id: committed?.revisionId ?? null,
      render_hash: committed?.renderHash ?? null,
      gateway_calls: gatewayCalls,
      instances: masks.map(({ label }, index) => ({
        i: index,
        label,
        bbox: summaries[index]!.bbox,
        layer_id: committed?.layers[index]!.layerId ?? null,
        mask: {
          artifact_hash: committed?.layers[index]!.artifactHash ?? null,
          bbox: summaries[index]!.bbox,
          pixels: summaries[index]!.pixels,
        },
      })),
    },
    warnings: [],
  };
}
