/* eslint-disable no-await-in-loop -- Graph ancestry must be inspected in dependency order. */
import { warningCodes, type Warning } from "@photoctl/protocol";
import { inspectGraphNode, type GraphNodeRecord } from "../graph/inspection.js";
import {
  imageNodeRegistry,
  resampleParametersSchema,
  resampleV1ParametersSchema,
} from "../graph/recipes.js";
import type { GraphDatabase } from "../graph/store.js";
import type { ExternalExecutionProvenance } from "../graph/types.js";
import {
  composeTransformMatrices,
  invertTransformMatrix,
  type TransformMatrix,
} from "../transforms.js";

export interface FillUpscaleIdentity {
  enabled: boolean;
  adapter: string | null;
  adapterVersion: string | null;
  model: string;
  promptId: string;
  promptVersion: number;
  originalPrompt: string;
  derivedPrompt: string;
}

export interface FillBranchDescriptor {
  contentRootId: string;
  /** Ordered from the layer root toward the strict composite. */
  descendants: GraphNodeRecord[];
  compensations: GraphNodeRecord[];
  transforms: GraphNodeRecord[];
  composite: GraphNodeRecord;
  resample: GraphNodeRecord;
  upscale?: GraphNodeRecord;
  generation: GraphNodeRecord;
  generationExecution: GraphNodeRecord["executions"][number];
  generationProvider: ExternalExecutionProvenance;
  densityInput: GraphNodeRecord;
  densityInputDimensions: { w: number; h: number };
  baseNodeId: string;
  /** Leading transform/compensation nodes already present when fill ran. */
  baseAncestry: GraphNodeRecord[];
  maskNodeId: string;
  crop: { x: number; y: number; w: number; h: number };
  frame: { w: number; h: number };
  currentMatrix: TransformMatrix;
  generationInputMatrix: TransformMatrix;
  generationDimensions: { w: number; h: number };
  /** Maps original generation pixels into the untransformed layer coordinate space. */
  generationPlacementMatrix: TransformMatrix;
  permanentMaskNodeId: string;
  upscaleIdentity?: FillUpscaleIdentity;
  sourceContext: { tier: string; pixelScale: number; resolutionLimited: boolean };
  upscaleExecution?: GraphNodeRecord["executions"][number];
  upscaleProvider?: ExternalExecutionProvenance;
}

/**
 * Describes the one canonical fill ancestry shared by retry, refresh, and later
 * transform-density maintenance. Descendants run from the layer root down toward
 * the strict composite; paid nodes remain named explicitly.
 */
export async function describeFillBranch(
  database: GraphDatabase,
  photoId: string,
  contentRootId: string,
): Promise<FillBranchDescriptor | undefined> {
  const outer = await inspectModifierPrefix(database, photoId, contentRootId);
  if (!outer) return undefined;
  const descendants = outer.nodes;
  const current = outer.terminal;
  const compositeParameters = imageNodeRegistry.mask_composite.parameters.safeParse(
    current.parameters,
  );
  if (
    current.kind !== "mask_composite" ||
    current.recipeVersion !== 1 ||
    current.inputNodeIds.length !== 3 ||
    !compositeParameters.success ||
    compositeParameters.data.feather !== 0
  )
    return undefined;
  const composite = current;
  const baseNodeId = composite.inputNodeIds[0]!;
  const base = await inspectModifierPrefix(database, photoId, baseNodeId);
  if (!base) return undefined;
  const resample = await inspectGraphNode(database, {
    photoId,
    nodeId: composite.inputNodeIds[1]!,
  });
  if (resample.kind !== "resample" || resample.inputNodeIds.length !== 1) return undefined;
  const generationRequestCandidate = await generationRequestBelow(database, photoId, resample);
  if (!generationRequestCandidate) return undefined;
  const crop = generationRequestCandidate.crop;
  const frame = resampleFrame(resample);
  if (!frame) return undefined;
  let placement = await inspectGraphNode(database, {
    photoId,
    nodeId: resample.inputNodeIds[0]!,
  });
  let upscale: GraphNodeRecord | undefined;
  if (placement.kind === "upscale") {
    if (
      placement.recipeVersion !== 1 ||
      placement.inputNodeIds.length !== 1 ||
      !validPaidNode(placement, "upscale")
    )
      return undefined;
    upscale = placement;
    placement = await inspectGraphNode(database, {
      photoId,
      nodeId: placement.inputNodeIds[0]!,
    });
  }
  if (
    placement.kind !== "generate" ||
    placement.recipeVersion !== 1 ||
    placement.inputNodeIds.length !== 1 ||
    !validPaidNode(placement, "generate")
  )
    return undefined;
  const generationRequest = asRecord(asRecord(placement.parameters)?.request);
  if (
    !Array.isArray(generationRequest?.crop) ||
    generationRequest.crop.length !== 4 ||
    generationRequest.crop.some((value, index) => value !== [crop.x, crop.y, crop.w, crop.h][index])
  )
    return undefined;
  const generationExecution = pinnedExecution(placement);
  const upscaleExecution = upscale ? pinnedExecution(upscale) : undefined;
  if (!generationExecution || (upscale && !upscaleExecution)) return undefined;
  const densityInputDimensions = await executionArtifactDimensions(
    database,
    upscaleExecution ?? generationExecution,
  );
  if (!densityInputDimensions) return undefined;
  const generationProvider = providerFromExecution(generationExecution);
  const upscaleProvider = upscaleExecution ? providerFromExecution(upscaleExecution) : undefined;
  const sourceContext = asSourceContext(generationRequest?.source_context);
  const storedInputMatrix = asMatrix(generationRequest?.input_matrix);
  const generationInput = await inspectModifierPrefix(
    database,
    photoId,
    placement.inputNodeIds[0]!,
  );
  if (!generationInput) return undefined;
  const mask = await inspectModifierPrefix(database, photoId, composite.inputNodeIds[2]!);
  if (!mask) return undefined;
  const outerMatrix = combinedTransform(descendants);
  const baseMatrix = combinedTransform(base.nodes);
  const maskMatrix = combinedTransform(mask.nodes);
  const currentMatrix = composeTransformMatrices(outerMatrix, maskMatrix);
  const resampleMatrix = await placementMatrix(
    database,
    resample,
    crop,
    generationRequestCandidate.returned,
  );
  if (!resampleMatrix || (resample.recipeVersion === 1 && !sameMatrix(baseMatrix, maskMatrix)))
    return undefined;
  const currentPlacement = composeTransformMatrices(outerMatrix, resampleMatrix);
  const generationPlacementMatrix = composeTransformMatrices(
    invertTransformMatrix(currentMatrix),
    currentPlacement,
  );
  const upscaleIdentity = asUpscaleIdentity(generationRequest?.upscale, upscale);
  if (!generationProvider || !sourceContext || (upscaleExecution && !upscaleProvider)) {
    return undefined;
  }
  return {
    contentRootId,
    descendants,
    compensations: descendants.filter(({ kind }) => kind === "delta"),
    transforms: descendants.filter(({ kind }) => kind === "transform"),
    composite,
    resample,
    ...(upscale ? { upscale } : {}),
    generation: placement,
    generationExecution,
    generationProvider,
    densityInput: upscale ?? placement,
    densityInputDimensions,
    baseNodeId,
    baseAncestry: base.nodes,
    maskNodeId: composite.inputNodeIds[2]!,
    crop,
    frame,
    currentMatrix,
    generationInputMatrix: storedInputMatrix ?? combinedTransform(generationInput.nodes),
    generationDimensions: generationRequestCandidate.returned,
    generationPlacementMatrix,
    permanentMaskNodeId: mask.terminal.id,
    ...(upscaleIdentity ? { upscaleIdentity } : {}),
    sourceContext,
    ...(upscaleExecution ? { upscaleExecution } : {}),
    ...(upscaleProvider ? { upscaleProvider } : {}),
  };
}

async function executionArtifactDimensions(
  database: GraphDatabase,
  execution: GraphNodeRecord["executions"][number],
): Promise<{ w: number; h: number } | undefined> {
  const result = await database.query<{ w: number; h: number }>(
    `SELECT w, h FROM image_artifacts
     WHERE artifact_hash = $1 AND artifact_available = true`,
    [execution.outputArtifactHash],
  );
  return result.rows[0];
}

function resampleFrame(resample: GraphNodeRecord): { w: number; h: number } | undefined {
  const parsed = (
    resample.recipeVersion === 1 ? resampleV1ParametersSchema : resampleParametersSchema
  ).safeParse(resample.parameters);
  return parsed.success ? { w: parsed.data.w, h: parsed.data.h } : undefined;
}

async function generationRequestBelow(
  database: GraphDatabase,
  photoId: string,
  resample: GraphNodeRecord,
): Promise<
  | { crop: { x: number; y: number; w: number; h: number }; returned: { w: number; h: number } }
  | undefined
> {
  let node = await inspectGraphNode(database, { photoId, nodeId: resample.inputNodeIds[0]! });
  if (node.kind === "upscale") {
    if (node.inputNodeIds.length !== 1) return undefined;
    node = await inspectGraphNode(database, { photoId, nodeId: node.inputNodeIds[0]! });
  }
  const request = asRecord(asRecord(node.parameters)?.request);
  if (
    node.kind !== "generate" ||
    !Array.isArray(request?.crop) ||
    request.crop.length !== 4 ||
    !request.crop.every(Number.isSafeInteger) ||
    !Array.isArray(request.returned) ||
    request.returned.length !== 2 ||
    !request.returned.every(positiveInteger)
  )
    return undefined;
  return {
    crop: { x: request.crop[0]!, y: request.crop[1]!, w: request.crop[2]!, h: request.crop[3]! },
    returned: { w: request.returned[0]!, h: request.returned[1]! },
  };
}

async function placementMatrix(
  database: GraphDatabase,
  resample: GraphNodeRecord,
  crop: { x: number; y: number; w: number; h: number },
  returned: { w: number; h: number },
): Promise<TransformMatrix | undefined> {
  if (resample.recipeVersion === 1) {
    const parsed = resampleV1ParametersSchema.safeParse(resample.parameters);
    if (!parsed.success || parsed.data.kernel !== "lanczos3" || !parsed.data.target)
      return undefined;
    const target = parsed.data.target;
    if (!sameRect(target, crop)) return undefined;
    return [target.w / returned.w, 0, 0, target.h / returned.h, target.x, target.y];
  }
  if (resample.recipeVersion === 2) {
    const parsed = resampleParametersSchema.safeParse(resample.parameters);
    if (!parsed.success) return undefined;
    const inputNode = await inspectGraphNode(database, {
      photoId: resample.photoId,
      nodeId: resample.inputNodeIds[0]!,
    });
    const execution = pinnedExecution(inputNode);
    if (!execution) return undefined;
    const dimensions = await database.query<{ w: number; h: number }>(
      `SELECT w, h FROM image_artifacts
       WHERE artifact_hash = $1 AND artifact_available = true`,
      [execution.outputArtifactHash],
    );
    const input = dimensions.rows[0];
    if (!input) return undefined;
    return composeTransformMatrices(parsed.data.matrix, [
      input.w / returned.w,
      0,
      0,
      input.h / returned.h,
      0,
      0,
    ]);
  }
  return undefined;
}

function combinedTransform(nodes: GraphNodeRecord[]): TransformMatrix {
  let matrix: TransformMatrix = [1, 0, 0, 1, 0, 0];
  for (const node of nodes.toReversed()) {
    if (node.kind !== "transform") continue;
    const parsed = imageNodeRegistry.transform.parameters.parse(node.parameters);
    matrix = composeTransformMatrices(parsed.matrix as unknown as TransformMatrix, matrix);
  }
  return matrix;
}

function sameMatrix(left: TransformMatrix, right: TransformMatrix): boolean {
  return left.every((value, index) => Math.abs(value - right[index]!) < 1e-9);
}

function asMatrix(value: unknown): TransformMatrix | undefined {
  return Array.isArray(value) &&
    value.length === 6 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
    ? (value as unknown as TransformMatrix)
    : undefined;
}

function sameRect(
  left: { x: number; y: number; w: number; h: number },
  right: { x: number; y: number; w: number; h: number },
): boolean {
  return left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h;
}

function asUpscaleIdentity(
  value: unknown,
  upscale: GraphNodeRecord | undefined,
): FillUpscaleIdentity | undefined {
  const stored = asRecord(value);
  if (
    stored &&
    typeof stored.enabled === "boolean" &&
    nullableString(stored.adapter) &&
    nullableString(stored.adapter_version) &&
    nonemptyString(stored.model) &&
    nonemptyString(stored.prompt_id) &&
    positiveInteger(stored.prompt_version) &&
    typeof stored.original_prompt === "string" &&
    typeof stored.derived_prompt === "string"
  ) {
    return {
      enabled: stored.enabled,
      adapter: stored.adapter,
      adapterVersion: stored.adapter_version,
      model: stored.model,
      promptId: stored.prompt_id,
      promptVersion: stored.prompt_version,
      originalPrompt: stored.original_prompt,
      derivedPrompt: stored.derived_prompt,
    };
  }
  const parameters = asRecord(upscale?.parameters);
  const controls = asRecord(parameters?.controls);
  if (
    !parameters ||
    !controls ||
    !nonemptyString(parameters.model) ||
    !nonemptyString(controls.prompt_id) ||
    !positiveInteger(controls.prompt_version) ||
    typeof controls.original_prompt !== "string" ||
    typeof controls.derived_prompt !== "string"
  )
    return undefined;
  return {
    enabled: true,
    adapter: typeof parameters.adapter === "string" ? parameters.adapter : null,
    adapterVersion: nullableString(parameters.adapter_version) ? parameters.adapter_version : null,
    model: parameters.model,
    promptId: controls.prompt_id,
    promptVersion: controls.prompt_version,
    originalPrompt: controls.original_prompt,
    derivedPrompt: controls.derived_prompt,
  };
}

export async function directUpscaleChildren(
  database: GraphDatabase,
  photoId: string,
  generationNodeId: string,
  identity: FillUpscaleIdentity,
): Promise<
  Array<{
    node: GraphNodeRecord;
    execution: GraphNodeRecord["executions"][number];
    provider: ExternalExecutionProvenance;
  }>
> {
  const rows = await database.query<{ id: string }>(
    `SELECT edge.node_id AS id FROM image_node_inputs AS edge
     JOIN image_nodes AS node ON node.photo_id = edge.photo_id AND node.id = edge.node_id
     WHERE edge.photo_id = $1 AND edge.input_node_id = $2 AND edge.input_index = 0
       AND node.kind = 'upscale' ORDER BY edge.node_id`,
    [photoId, generationNodeId],
  );
  const matches = [];
  for (const { id } of rows.rows) {
    const node = await inspectGraphNode(database, { photoId, nodeId: id });
    const parameters = asRecord(node.parameters);
    const controls = asRecord(parameters?.controls);
    if (
      (identity.adapter !== null && parameters?.adapter !== identity.adapter) ||
      parameters?.adapter_version !== identity.adapterVersion ||
      parameters?.model !== identity.model ||
      controls?.prompt_id !== identity.promptId ||
      controls?.prompt_version !== identity.promptVersion ||
      controls?.original_prompt !== identity.originalPrompt ||
      controls?.derived_prompt !== identity.derivedPrompt
    )
      continue;
    const execution = pinnedExecution(node);
    const provider = execution ? providerFromExecution(execution) : undefined;
    if (execution && provider) matches.push({ node, execution, provider });
  }
  return matches;
}

async function inspectModifierPrefix(
  database: GraphDatabase,
  photoId: string,
  root: string,
): Promise<{ nodes: GraphNodeRecord[]; terminal: GraphNodeRecord } | undefined> {
  const nodes: GraphNodeRecord[] = [];
  let terminal = await inspectGraphNode(database, { photoId, nodeId: root });
  while (terminal.kind === "delta" || terminal.kind === "transform") {
    if (terminal.inputNodeIds.length !== 1) return undefined;
    nodes.push(terminal);
    terminal = await inspectGraphNode(database, {
      photoId,
      nodeId: terminal.inputNodeIds[0]!,
    });
  }
  return { nodes, terminal };
}

function providerFromExecution(
  execution: GraphNodeRecord["executions"][number],
): ExternalExecutionProvenance | undefined {
  const value = asRecord(execution.providerProvenance);
  if (
    !value ||
    !nonemptyString(value.adapter) ||
    !nullableString(value.adapter_version) ||
    !nonemptyString(value.service) ||
    !nonemptyString(value.model) ||
    !nullableString(value.model_version) ||
    !nullableString(value.provider_request_id) ||
    !(value.seed === null || (typeof value.seed === "number" && Number.isFinite(value.seed))) ||
    !nonnegativeNumber(value.duration_ms) ||
    !nonnegativeNumber(value.cost_usd) ||
    !nonnegativeNumber(value.input_px) ||
    !nonnegativeNumber(value.target_px) ||
    !positiveInteger(value.attempt) ||
    !["satisfied", "limited", "not-applicable"].includes(String(value.density_verdict)) ||
    !validWarnings(value.warnings)
  )
    return undefined;
  return {
    adapter: value.adapter,
    adapterVersion: value.adapter_version,
    service: value.service,
    model: value.model,
    modelVersion: value.model_version,
    providerRequestId: value.provider_request_id,
    seed: value.seed,
    durationMs: value.duration_ms,
    costUsd: value.cost_usd,
    inputPx: value.input_px,
    targetPx: value.target_px,
    attempt: value.attempt,
    densityVerdict: value.density_verdict as ExternalExecutionProvenance["densityVerdict"],
    warnings: value.warnings,
  };
}

function validPaidNode(node: GraphNodeRecord, kind: "generate" | "upscale"): boolean {
  const parsed = imageNodeRegistry[kind].parameters.safeParse(node.parameters);
  if (!parsed.success) return false;
  const parameters = parsed.data;
  const request = asRecord(parameters?.request);
  if (
    typeof request?.execution_id !== "string" ||
    !/^exec_[0-9a-f]{64}$/.test(request.execution_id)
  )
    return false;
  if (kind === "generate") {
    return (
      typeof parameters.prompt === "string" &&
      positiveInteger(parameters.prompt_version) &&
      (request.operation === "remove" || request.operation === "prompt") &&
      Array.isArray(request.crop) &&
      request.crop.length === 4 &&
      request.crop.every(Number.isSafeInteger) &&
      Array.isArray(request.returned) &&
      request.returned.length === 2 &&
      request.returned.every(positiveInteger) &&
      Boolean(asSourceContext(request.source_context))
    );
  }
  const controls = asRecord(parameters.controls);
  return (
    controls !== undefined &&
    nonemptyString(controls.prompt_id) &&
    positiveInteger(controls.prompt_version) &&
    typeof controls.original_prompt === "string" &&
    typeof controls.derived_prompt === "string"
  );
}

function pinnedExecution(node: GraphNodeRecord) {
  const executionId = asRecord(asRecord(node.parameters)?.request)?.execution_id;
  return node.executions.find(
    (execution) =>
      execution.executionId === executionId &&
      execution.artifactAvailable &&
      execution.providerProvenance !== null,
  );
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validWarnings(value: unknown): value is Warning[] {
  return (
    Array.isArray(value) &&
    value.every((warning) => {
      const record = asRecord(warning);
      return (
        record !== undefined &&
        warningCodes.includes(record.code as (typeof warningCodes)[number]) &&
        typeof record.message === "string"
      );
    })
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asSourceContext(
  value: unknown,
): { tier: string; pixelScale: number; resolutionLimited: boolean } | undefined {
  const context = asRecord(value);
  if (
    !context ||
    typeof context.tier !== "string" ||
    typeof context.pixel_scale !== "number" ||
    typeof context.resolution_limited !== "boolean"
  )
    return undefined;
  return {
    tier: context.tier,
    pixelScale: context.pixel_scale,
    resolutionLimited: context.resolution_limited,
  };
}
