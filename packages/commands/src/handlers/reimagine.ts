import type { LibraryHandle } from "@photoctl/library";
import { buildReimaginePrompt } from "@photoctl/providers";
import { PhotoctlError, type Envelope, type ReimagineData } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import type { RequestEnv } from "../context.js";
import type { GenerationCommandDependencies } from "./generation-source.js";
import { executeFullFrameGeneration } from "./full-frame-generation.js";

export async function reimagineCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedDependencies?: GenerationCommandDependencies,
  emit?: (event: import("@photoctl/protocol").StderrEvent) => void | Promise<void>,
): Promise<Envelope> {
  const parsed = parseArguments(args, { options: ["--prompt", "--strength"] });
  if (parsed.positionals.length !== 1)
    throw new PhotoctlError("usage", "reimagine requires exactly one photo ID or prefix");
  const prompt = parsed.options.get("--prompt");
  if (!prompt) throw new PhotoctlError("usage", "reimagine requires --prompt");
  const strength = parseStrength(parsed.options.get("--strength"));
  const built = buildReimaginePrompt(prompt, strength);
  const { id, result, generation, source_context, upscale, executions } =
    await executeFullFrameGeneration(
      {
        id: parsed.positionals[0]!,
        prompt,
        providerPrompt: built.derived,
        promptVersion: built.version,
        strength,
        operation: "reimagine",
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
      strength,
      generation,
      source_context,
      upscale,
      executions,
    } satisfies ReimagineData,
    warnings: result.warnings,
  };
}

function parseStrength(value: string | undefined): number {
  if (value === undefined) return 1;
  const strength = Number(value);
  if (!Number.isFinite(strength) || strength < 0 || strength > 1)
    throw new PhotoctlError("usage", "--strength must be between 0 and 1");
  return strength;
}
