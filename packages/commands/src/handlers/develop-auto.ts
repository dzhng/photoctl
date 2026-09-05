import type { LibraryHandle } from "@photoctl/library";
import {
  applyDevelopMutation,
  developDictSchema,
  measureDevelopStats,
  type DevelopDict,
  type DevelopKey,
  type JsonValue,
  type PreviewCoordinator,
} from "@photoctl/render";
import {
  AUTO_ENHANCE_PROMPT_VERSION,
  AUTO_ENHANCE_RANGES,
  autoEnhanceSchema,
  buildAutoEnhancePrompt,
  GatewayClient,
  GatewayStructuredModelAdapter,
  readProviderSettings,
  resolveModels,
  type AutoEnhancePath,
  type AutoEnhanceProposal,
  type StructuredImage,
  type StructuredModelAdapter,
} from "@photoctl/providers";
import { PhotoctlError, type ShowData, type Warning } from "@photoctl/protocol";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { RequestEnv } from "../context.js";
import { showCommand } from "./show.js";

export interface DevelopDependencies {
  structured?: StructuredModelAdapter;
  image?: StructuredImage;
}

export async function planAutoEnhance(request: {
  id: string;
  current: DevelopDict;
  handle: LibraryHandle;
  env: RequestEnv;
  cwd: string;
  previewCoordinator?: PreviewCoordinator;
  dependencies?: DevelopDependencies;
}): Promise<{
  develop: DevelopDict;
  metadata: Record<string, JsonValue>;
  warnings: Warning[];
}> {
  const structured =
    request.dependencies?.structured ??
    (await configuredStructuredAdapter(request.handle, request.env));
  const preview = request.dependencies?.image
    ? { image: request.dependencies.image, warnings: [] }
    : await materializeAutoEnhancePreview(
        request.id,
        request.env,
        request.cwd,
        request.handle,
        request.previewCoordinator,
      );
  const { image } = preview;
  const stats = await statsForImage(image, request.id);
  let answer;
  try {
    answer = await structured.ask(
      autoEnhanceSchema,
      [image],
      buildAutoEnhancePrompt(JSON.stringify(stats)),
    );
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    throw new PhotoctlError(
      "provider_busy",
      "Auto-enhance provider returned unusable adjustments",
      {
        id: request.id,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
  return {
    develop: applyDevelopMutation(request.current, { set: clampedAssignments(answer.value) }),
    metadata: jsonValue({
      auto_enhance_version: 1,
      develop_before_auto: request.current,
      provider_execution: {
        operation: "auto-enhance",
        adapter: structured.id,
        adapter_version: structured.version,
        model: answer.model,
        provider_request_id: answer.requestId,
        attempt: answer.attempts,
        prompt_version: AUTO_ENHANCE_PROMPT_VERSION,
        preview: image.dimensions,
        stats,
      },
    }),
    warnings: preview.warnings,
  };
}

export function readAutoEnhanceSnapshot(
  metadata: Record<string, JsonValue> | null,
  id: string,
): DevelopDict {
  const snapshot =
    metadata?.auto_enhance_version === 1 &&
    typeof metadata.provider_execution === "object" &&
    metadata.provider_execution !== null &&
    !Array.isArray(metadata.provider_execution) &&
    metadata.provider_execution.operation === "auto-enhance"
      ? metadata.develop_before_auto
      : undefined;
  const restored = developDictSchema.safeParse(snapshot);
  if (restored.success) return restored.data;
  throw new PhotoctlError("usage", "The active revision has no auto-enhance change to undo", {
    id,
  });
}

async function configuredStructuredAdapter(
  handle: LibraryHandle,
  env: RequestEnv,
): Promise<StructuredModelAdapter> {
  if (!env.gatewayApiKey) {
    throw new PhotoctlError("provider_unconfigured", "AI_GATEWAY_API_KEY is not configured");
  }
  const model = resolveModels((await readProviderSettings(handle)).models).structured;
  return new GatewayStructuredModelAdapter({
    gateway: new GatewayClient({ apiKey: env.gatewayApiKey, baseUrl: env.gatewayUrl }),
    model,
  });
}

async function materializeAutoEnhancePreview(
  id: string,
  env: RequestEnv,
  cwd: string,
  handle: LibraryHandle,
  previewCoordinator?: PreviewCoordinator,
): Promise<{ image: StructuredImage; warnings: Warning[] }> {
  const envelope = await showCommand(
    [id, "--preview-size", "1024"],
    env,
    cwd,
    handle,
    previewCoordinator,
  );
  if (!envelope.ok || !("data" in envelope)) {
    throw new Error("Could not materialize the auto-enhance preview");
  }
  const preview = (envelope.data as ShowData).preview;
  const bytes = await readFile(preview);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height)
    throw new Error("Auto-enhance preview has no dimensions");
  return {
    image: {
      bytes,
      mediaType: "image/jpeg",
      dimensions: { w: metadata.width, h: metadata.height },
    },
    warnings: envelope.warnings,
  };
}

async function statsForImage(image: StructuredImage, id: string) {
  try {
    const decoded = await sharp(image.bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (decoded.info.channels !== 3 && decoded.info.channels !== 4) {
      throw new Error("preview must decode to RGB pixels");
    }
    return measureDevelopStats({
      pixels: decoded.data,
      w: decoded.info.width,
      h: decoded.info.height,
      channels: decoded.info.channels,
    });
  } catch (error) {
    throw new PhotoctlError("decoder_unavailable", "Auto-enhance preview could not be decoded", {
      id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function clampedAssignments(proposal: AutoEnhanceProposal): string[] {
  return [
    ...(
      [
        "exposure",
        "highlights",
        "shadows",
        "contrast",
        "black_point",
        "vibrance",
        "saturation",
      ] as const
    ).flatMap((key) => (proposal[key] === undefined ? [] : [assignment(key, proposal[key])])),
    ...(proposal.white_balance
      ? [assignment("white_balance.temp_offset_k", proposal.white_balance.temp_offset_k)]
      : []),
  ];
}

function assignment(path: AutoEnhancePath & DevelopKey, value: number): string {
  const range = AUTO_ENHANCE_RANGES[path];
  return `${path}=${Math.max(range[0], Math.min(range[1], value))}`;
}

function jsonValue(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}
