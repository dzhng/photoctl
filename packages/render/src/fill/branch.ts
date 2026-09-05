/* eslint-disable no-await-in-loop -- Graph ancestry must be inspected in dependency order. */
import { warningCodes, type Warning } from "@photoctl/protocol";
import { inspectGraphNode, type GraphNodeRecord } from "../graph/inspection.js";
import { imageNodeRegistry, resampleV1ParametersSchema } from "../graph/recipes.js";
import type { GraphDatabase } from "../graph/store.js";
import type { ExternalExecutionProvenance } from "../graph/types.js";

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
  baseNodeId: string;
  /** Leading transform/compensation nodes already present when fill ran. */
  baseAncestry: GraphNodeRecord[];
  maskNodeId: string;
  crop: { x: number; y: number; w: number; h: number };
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
  if (
    resample.kind !== "resample" ||
    resample.recipeVersion !== 1 ||
    resample.inputNodeIds.length !== 1
  )
    return undefined;
  const parsedResample = resampleV1ParametersSchema.safeParse(resample.parameters);
  const resampleParameters = parsedResample.success ? parsedResample.data : undefined;
  const crop = resampleParameters?.target;
  if (!crop || resampleParameters.kernel !== "lanczos3") return undefined;
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
  const generationProvider = providerFromExecution(generationExecution);
  const upscaleProvider = upscaleExecution ? providerFromExecution(upscaleExecution) : undefined;
  const sourceContext = asSourceContext(generationRequest?.source_context);
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
    baseNodeId,
    baseAncestry: base.nodes,
    maskNodeId: composite.inputNodeIds[2]!,
    crop,
    sourceContext,
    ...(upscaleExecution ? { upscaleExecution } : {}),
    ...(upscaleProvider ? { upscaleProvider } : {}),
  };
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
