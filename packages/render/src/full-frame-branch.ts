import { z } from "zod";
import { savedFrameSchema } from "./graph/frame.js";
import { inspectGraphNode } from "./graph/inspection.js";
import type { GraphDatabase } from "./graph/store.js";
import {
  asUpscaleIdentity,
  inspectModifierPrefix,
  pinnedExecution,
  providerFromExecution,
} from "./fill/branch.js";

export const fullFrameIntentSchema = z.object({
  input_policy: z.literal("photographic-composite"),
  input_frame: savedFrameSchema,
  authored_frame: savedFrameSchema,
  input_execution_id: z.string(),
  predecessor_layer_ids: z.array(z.uuid()),
});

const generationSchema = z.object({
  adapter: z.string(),
  adapter_version: z.string(),
  model: z.string(),
  prompt: z.string(),
  prompt_version: z.number(),
  request: z.object({
    scope: z.literal("full-frame"),
    drift: z.literal("full-frame"),
    blend_coverage: z.number().min(0).max(1),
    strength: z.number().min(0).max(1),
    provider_prompt: z.string(),
    full_frame: fullFrameIntentSchema,
    source_context: z.object({
      tier: z.string(),
      pixel_scale: z.number(),
      resolution_limited: z.boolean(),
    }),
    upscale: z.unknown(),
  }),
});

export async function describeFullFrameBranch(
  database: GraphDatabase,
  photoId: string,
  selected: { contentNodeId: string },
) {
  const prefix = await inspectModifierPrefix(database, photoId, selected.contentNodeId);
  if (!prefix) return undefined;
  const upscale = prefix.terminal.kind === "upscale" ? prefix.terminal : undefined;
  const generation = upscale
    ? await inspectGraphNode(database, { photoId, nodeId: upscale.inputNodeIds[0]! })
    : prefix.terminal;
  if (generation.kind !== "generate") return undefined;
  const parsed = generationSchema.safeParse(generation.parameters);
  if (!parsed.success) return undefined;
  const generationExecution = pinnedExecution(generation);
  const generationProvider = generationExecution && providerFromExecution(generationExecution);
  if (!generationExecution || !generationProvider)
    throw new Error("The purchased generation is unavailable");
  const upscaleIdentity = asUpscaleIdentity(parsed.data.request.upscale, upscale);
  if (!upscaleIdentity) throw new Error("Full-frame generation has no retained upscale policy");
  const upscaleExecution = upscale && pinnedExecution(upscale);
  const upscaleProvider = upscaleExecution && providerFromExecution(upscaleExecution);
  const context = parsed.data.request.source_context;
  return {
    operation: "full-frame" as const,
    descendants: prefix.nodes,
    generation,
    generationExecution,
    generationProvider,
    ...(upscale ? { upscale, upscaleExecution, upscaleProvider } : {}),
    upscaleIdentity,
    parameters: parsed.data,
    sourceContext: {
      tier: context.tier,
      pixelScale: context.pixel_scale,
      resolutionLimited: context.resolution_limited,
    },
  };
}

export type FullFrameBranch = NonNullable<Awaited<ReturnType<typeof describeFullFrameBranch>>>;
