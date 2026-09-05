import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type {
  ImageNodeKind,
  JsonValue,
  LogicalNodeRecipeInput,
  SourceExecutionProvenance,
} from "./types.js";
import { developDictSchema } from "../develop/dict.js";

const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);
const concreteModelSchema = z
  .string()
  .min(1)
  .refine((model) => model !== "auto" && model !== "latest" && !model.endsWith("/latest"));
export const externalExecutionRequestSchema = z
  .object({
    execution_id: z
      .string()
      .regex(/^exec_[0-9a-f]{64}$/)
      .optional(),
  })
  .catchall(jsonSchema);

export interface ImageNodeDefinition {
  parameters: z.ZodType<Record<string, JsonValue>>;
  inputs: { minimum: number; maximum: number };
  deterministic: boolean;
  recipeVersions: readonly number[];
}

export const resampleV1ParametersSchema = z
  .object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    kernel: z.enum(["nearest", "bilinear", "bicubic", "lanczos3"]),
    target: z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        w: z.number().int().positive(),
        h: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((parameters, context) => {
    if (
      parameters.target &&
      (parameters.target.x + parameters.target.w > parameters.w ||
        parameters.target.y + parameters.target.h > parameters.h)
    ) {
      context.addIssue({
        code: "custom",
        message: "Resample target rectangle must fit inside its output canvas",
        path: ["target"],
      });
    }
  });

export const resampleParametersSchema = z
  .object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    kernel: z.literal("lanczos3"),
    matrix: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
  })
  .strict()
  .superRefine(({ matrix }, context) => {
    const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    const inverse = [
      matrix[3] / determinant,
      -matrix[1] / determinant,
      -matrix[2] / determinant,
      matrix[0] / determinant,
      (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
      (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
    ];
    if (
      determinant === 0 ||
      !Number.isFinite(determinant) ||
      inverse.some((value) => !Number.isFinite(value))
    ) {
      context.addIssue({
        code: "custom",
        message: "Resample matrix must have a finite inverse",
        path: ["matrix"],
      });
    }
  });

export const imageNodeRegistry = {
  source: definition(
    z
      .object({
        orientation: z.number().int().min(1).max(8),
      })
      .strict(),
    0,
    0,
    true,
  ),
  develop: definition(developDictSchema, 1, 1, true),
  generate: definition(
    z
      .object({
        adapter: z.string().min(1),
        adapter_version: z.string().min(1).nullable(),
        model: concreteModelSchema,
        model_version: z.string().min(1).nullable(),
        prompt: z.string(),
        prompt_version: z.number().int().positive(),
        request: externalExecutionRequestSchema,
      })
      .strict(),
    1,
    1,
    false,
  ),
  upscale: definition(
    z
      .object({
        adapter: z.string().min(1),
        adapter_version: z.string().min(1).nullable(),
        model: concreteModelSchema,
        model_version: z.string().min(1).nullable(),
        scale: z.number().positive(),
        controls: z.record(z.string(), jsonSchema),
        request: externalExecutionRequestSchema,
      })
      .strict(),
    1,
    1,
    false,
  ),
  resample: definition(
    z.union([resampleV1ParametersSchema, resampleParametersSchema]),
    1,
    1,
    true,
    [1, 2],
  ),
  transform: definition(
    z
      .object({
        matrix: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
      })
      .strict(),
    1,
    1,
    true,
  ),
  solid: definition(
    z
      .object({
        w: z.number().int().positive(),
        h: z.number().int().positive(),
        space: z.literal("scene-linear-rec2020"),
        rgb: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
      })
      .strict(),
    0,
    0,
    true,
  ),
  mask: definition(
    z.object({ artifact_hash: z.string().regex(/^a_[0-9a-f]{64}$/) }).strict(),
    0,
    0,
    true,
  ),
  delta: definition(developDictSchema, 1, 1, true),
  heal: definition(
    z
      .object({
        method: z.literal("fast-marching-harmonic"),
        at: z.tuple([z.number().finite(), z.number().finite()]),
        radius: z.number().positive(),
        neighborhood_radius: z.number().int().min(1).max(16),
        refinement_iterations: z.number().int().min(1).max(4096),
        refinement_pixel_budget: z.number().int().min(1).max(100_000_000),
      })
      .strict(),
    2,
    2,
    true,
  ),
  mask_composite: definition(z.object({ feather: z.number().nonnegative() }).strict(), 3, 3, true),
  composite: definition(
    z.union([
      z
        .object({ opacity: z.number().min(0).max(1), blend: z.enum(["normal"]).default("normal") })
        .strict(),
      z
        .object({
          layers: z.array(
            z.object({ opacity: z.number().min(0).max(1), blend: z.enum(["normal"]) }).strict(),
          ),
        })
        .strict(),
    ]),
    1,
    Number.MAX_SAFE_INTEGER,
    true,
    [1, 2],
  ),
  crop: definition(
    z
      .object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })
      .strict(),
    1,
    1,
    true,
  ),
  markup: definition(z.object({ document: z.record(z.string(), jsonSchema) }).strict(), 1, 1, true),
  output: definition(
    z
      .object({
        format: z.enum(["linear-rgb", "display-rgb", "mask"]),
        color_space: z.string().min(1),
      })
      .strict(),
    1,
    1,
    true,
  ),
} satisfies Record<ImageNodeKind, ImageNodeDefinition>;

export function canonicalNodeRecipe(input: LogicalNodeRecipeInput): string {
  const nodeDefinition = imageNodeRegistry[input.kind];
  assertRecipeVersion(input.kind, input.recipeVersion);
  assertInputCount(input.kind, nodeDefinition.inputs, input.inputNodeIds.length);
  assertVersionedInputCount(input.kind, input.recipeVersion, input.inputNodeIds.length);
  assertVersionedRecipeShape(input);
  for (const id of input.inputNodeIds) assertHash(id, "node");
  return canonicalJson({
    input_node_ids: input.inputNodeIds,
    kind: input.kind,
    parameters: canonicalParameters(input.kind, input.recipeVersion, input.parameters),
    recipe_version: input.recipeVersion,
  });
}

function assertVersionedRecipeShape(input: LogicalNodeRecipeInput): void {
  if (input.kind !== "composite") return;
  const parameters = input.parameters as Record<string, JsonValue>;
  if (input.recipeVersion === 1) {
    if (!("opacity" in parameters)) {
      throw new Error("composite recipe version 1 requires opacity and blend parameters");
    }
  }
  if (input.recipeVersion === 2) {
    const layers = parameters.layers;
    if (!Array.isArray(layers) || input.inputNodeIds.length !== 1 + layers.length * 2) {
      throw new Error(
        "composite recipe version 2 requires one base and one content/mask pair per layer",
      );
    }
  }
}

export function recipeHash(canonical: string): `recipe_${string}` {
  return hashIdentity("recipe", canonical);
}

export function logicalNodeId(recipe: string): `node_${string}` {
  assertHash(recipe, "recipe");
  return hashIdentity("node", recipe);
}

export function renderHashForNode(nodeId: string): `r_${string}` {
  assertHash(nodeId, "node");
  return hashIdentity("r", nodeId);
}

export function evaluationHash(input: {
  nodeRecipeHash: string;
  kind: ImageNodeKind;
  recipeVersion: number;
  inputArtifactHashes: string[];
  source?: SourceExecutionProvenance & { outputArtifactHash: string };
}): `eval_${string}` {
  assertHash(input.nodeRecipeHash, "recipe");
  assertRecipeVersion(input.kind, input.recipeVersion);
  if (input.kind === "source" && !input.source) {
    throw new Error("Source evaluation requires source provenance");
  }
  if (input.kind !== "source" && input.source) {
    throw new Error("Source provenance is only valid for source evaluation");
  }
  assertInputCount(
    input.kind,
    imageNodeRegistry[input.kind].inputs,
    input.inputArtifactHashes.length,
  );
  assertVersionedInputCount(input.kind, input.recipeVersion, input.inputArtifactHashes.length);
  for (const hash of input.inputArtifactHashes) assertHash(hash, "a");
  return hashIdentity(
    "eval",
    canonicalJson({
      input_artifact_hashes: input.inputArtifactHashes,
      kind: input.kind,
      node_recipe_hash: input.nodeRecipeHash,
      recipe_version: input.recipeVersion,
      source: input.source ? canonicalSourceProvenance(input.source) : null,
    }),
  );
}

export function deterministicExecutionId(evaluation: string): `exec_${string}` {
  assertHash(evaluation, "eval");
  return hashIdentity("exec", evaluation);
}

export function newExecutionId(): `exec_${string}` {
  return `exec_${randomBytes(32).toString("hex")}`;
}

export function canonicalParameters(
  kind: ImageNodeKind,
  recipeVersion: number,
  value: JsonValue,
): JsonValue {
  assertRecipeVersion(kind, recipeVersion);
  const schema =
    kind === "resample"
      ? recipeVersion === 1
        ? resampleV1ParametersSchema
        : resampleParametersSchema
      : imageNodeRegistry[kind].parameters;
  return sortJson(schema.parse(value) as JsonValue);
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortJson(jsonSchema.parse(value)));
}

export function assertHash(value: string, prefix: string): void {
  if (!new RegExp(`^${prefix}_[0-9a-f]{64}$`).test(value)) {
    throw new Error(`Expected ${prefix}_ followed by a full SHA-256 hash`);
  }
}

function canonicalSourceProvenance(
  source: SourceExecutionProvenance & { outputArtifactHash: string },
): JsonValue {
  return z
    .object({
      locator: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("online-file"),
            volume_uuid: z.string().min(1),
            rel_path: z.string().min(1),
          })
          .strict(),
        z
          .object({
            kind: z.literal("online-jpeg-range"),
            volume_uuid: z.string().min(1),
            rel_path: z.string().min(1),
            offset: z.number().int().nonnegative(),
            length: z.number().int().positive(),
          })
          .strict(),
        z.object({ kind: z.literal("pinned-preview"), cache_path: z.string().min(1) }).strict(),
      ]),
      tier: z.enum(["online-file", "online-jpeg-range", "pinned-preview"]),
      w: z.number().int().positive(),
      h: z.number().int().positive(),
      decoderId: z.string().min(1),
      decoderVersion: z.string().min(1),
      outputArtifactHash: z.string().regex(/^a_[0-9a-f]{64}$/),
    })
    .strict()
    .refine((value) => value.locator.kind === value.tier, "source locator and tier must agree")
    .transform((value) => ({
      decoder_id: value.decoderId,
      decoder_version: value.decoderVersion,
      h: value.h,
      locator: value.locator,
      output_artifact_hash: value.outputArtifactHash,
      tier: value.tier,
      w: value.w,
    }))
    .parse(source) as JsonValue;
}

function assertRecipeVersion(kind: ImageNodeKind, version: number): void {
  if (!Number.isSafeInteger(version) || !imageNodeRegistry[kind].recipeVersions.includes(version)) {
    throw new Error(`${kind} does not support recipe version ${version}`);
  }
}

function assertInputCount(
  kind: ImageNodeKind,
  arity: { minimum: number; maximum: number },
  count: number,
): void {
  if (count >= arity.minimum && count <= arity.maximum) return;
  const expected =
    arity.minimum === arity.maximum ? String(arity.minimum) : `at least ${arity.minimum}`;
  throw new Error(`${kind} expects ${expected} inputs; received ${count}`);
}

function assertVersionedInputCount(kind: ImageNodeKind, version: number, count: number): void {
  if (kind !== "composite") return;
  if (version === 1 && count < 2) {
    throw new Error("composite recipe version 1 requires at least two inputs");
  }
  if (version === 2 && count % 2 !== 1) {
    throw new Error("composite recipe version 2 requires one base and content/mask input pairs");
  }
}

function definition(
  parameters: z.ZodType<Record<string, JsonValue>>,
  minimum: number,
  maximum: number,
  deterministic: boolean,
  recipeVersions: readonly number[] = [1],
): ImageNodeDefinition {
  return { parameters, inputs: { minimum, maximum }, deterministic, recipeVersions };
}

function hashIdentity<Prefix extends string>(prefix: Prefix, input: string): `${Prefix}_${string}` {
  return `${prefix}_${createHash("sha256").update(input).digest("hex")}`;
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}
