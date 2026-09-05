import type { LibraryHandle } from "@photoctl/library";
import { buildRelightPrompt } from "@photoctl/providers";
import { PhotoctlError, type Envelope, type RelightData } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import type { RequestEnv } from "../context.js";
import type { GenerationCommandDependencies } from "./generation-source.js";
import { executeFullFrameGeneration } from "./full-frame-generation.js";

export async function relightCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedDependencies?: GenerationCommandDependencies,
  emit?: (event: import("@photoctl/protocol").StderrEvent) => void | Promise<void>,
): Promise<Envelope> {
  const parsed = parseArguments(args, {
    options: ["--azimuth", "--elevation", "--intensity"],
  });
  if (parsed.positionals.length !== 1)
    throw new PhotoctlError("usage", "relight requires exactly one photo ID or prefix");
  const azimuth = parseControl(parsed.options.get("--azimuth"), "--azimuth", 0, 360);
  const elevation = parseControl(parsed.options.get("--elevation"), "--elevation", -90, 90);
  const intensity = parseControl(parsed.options.get("--intensity"), "--intensity", 0, 1);
  const prompt = buildRelightPrompt({ azimuth, elevation, intensity });
  const { id, result, generation, source_context, upscale, executions } =
    await executeFullFrameGeneration(
      {
        id: parsed.positionals[0]!,
        prompt: prompt.original,
        providerPrompt: prompt.derived,
        promptVersion: prompt.version,
        strength: intensity,
        operation: "relight",
      },
      env,
      cwd,
      provided,
      providedDependencies,
      emit,
    );
  return {
    schema: 1,
    ok: true,
    data: {
      id,
      layer_id: result.layerId,
      revision_id: result.revisionId,
      render_hash: result.renderHash,
      output_node: result.outputNodeId,
      drift: "full-frame",
      azimuth,
      elevation,
      intensity,
      generation,
      source_context,
      upscale,
      executions,
    } satisfies RelightData,
    warnings: result.warnings,
  };
}

function parseControl(value: string | undefined, name: string, min: number, max: number): number {
  if (value === undefined) throw new PhotoctlError("usage", `relight requires ${name}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max)
    throw new PhotoctlError("usage", `${name} must be between ${min} and ${max}`);
  return parsed;
}
