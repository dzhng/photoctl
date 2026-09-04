import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type Envelope } from "@photoctl/protocol";
import { ensurePhotoDocument, inspectGraph, inspectGraphNode } from "@photoctl/render";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";

export async function graphCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const action = args[0];
  if (action !== "show" && action !== "node") {
    throw new PhotoctlError("usage", "graph requires show or node");
  }
  const parsed = parseArguments(args.slice(1), {
    flags: action === "show" ? ["--history"] : [],
    options: action === "show" ? ["--layer", "--limit", "--cursor"] : [],
  });
  const requiredPositionals = action === "show" ? 1 : 2;
  if (parsed.positionals.length !== requiredPositionals) {
    throw new PhotoctlError(
      "usage",
      action === "show"
        ? "graph show requires one photo ID or prefix"
        : "graph node requires a photo ID or prefix and one full node ID",
    );
  }
  const layer = parsed.options.get("--layer");
  if (layer && layer !== "output") {
    throw new PhotoctlError("usage", "Only the output graph root exists before layers land");
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const photoId = await resolvePhotoId(lease.handle, parsed.positionals[0]);
    if (action === "show") {
      const orientation = await lease.handle.query<{ orientation: number }>(
        "SELECT orientation FROM photos WHERE id = $1",
        [photoId],
      );
      await ensurePhotoDocument(lease.handle, {
        photoId,
        orientation: orientation.rows[0]!.orientation,
      });
      let page;
      try {
        page = await inspectGraph(lease.handle, {
          photoId,
          history: parsed.flags.has("--history"),
          limit: parseLimit(parsed.options.get("--limit")),
          cursor: parsed.options.get("--cursor"),
        });
      } catch (error) {
        const message = errorMessage(error);
        if (message.includes("graph cursor") || message.includes("Graph cursor")) {
          throw new PhotoctlError("usage", message);
        }
        if (message.startsWith("Photo has no document revision:")) {
          throw new PhotoctlError("not_found", message, { id: photoId });
        }
        throw error;
      }
      if (!page.roots.output || !page.renderHash) {
        throw new PhotoctlError("not_found", `Photo has no output graph: ${photoId}`, {
          id: photoId,
        });
      }
      return {
        schema: 1,
        ok: true,
        data: {
          id: photoId,
          revision_id: page.revisionId,
          parent_revision_id: page.parentRevisionId,
          pinned: page.pinned,
          scope: { root: "output", history: parsed.flags.has("--history") },
          roots: { output: page.roots.output },
          render_hash: page.renderHash,
          nodes: page.nodes.map((node) => ({
            id: node.id,
            kind: node.kind,
            recipe_version: node.recipeVersion,
            recipe_hash: node.recipeHash,
            input_node_ids: node.inputNodeIds,
            input_count: node.inputCount,
            execution_count: node.executionCount,
            artifact_available: node.artifactAvailable,
          })),
          next_cursor: page.nextCursor,
        },
        warnings: [],
      };
    }

    const nodeId = parsed.positionals[1];
    if (!/^node_[0-9a-f]{64}$/.test(nodeId)) {
      throw new PhotoctlError("usage", "graph node requires a full node_<64 hex> identity");
    }
    let node;
    try {
      node = await inspectGraphNode(lease.handle, { photoId, nodeId });
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith("Graph node does not exist for photo:")) {
        throw new PhotoctlError("not_found", message, { id: photoId, node_id: nodeId });
      }
      throw error;
    }
    return {
      schema: 1,
      ok: true,
      data: {
        id: node.id,
        photo_id: node.photoId,
        kind: node.kind,
        recipe_version: node.recipeVersion,
        recipe_hash: node.recipeHash,
        parameters: node.parameters,
        parameters_truncated: node.parametersTruncated,
        input_node_ids: node.inputNodeIds,
        input_count: node.inputCount,
        consumer_node_ids: node.consumerNodeIds,
        consumer_count: node.consumerCount,
        executions: node.executions.map((execution) => ({
          execution_id: execution.executionId,
          evaluation_hash: execution.evaluationHash,
          deterministic: execution.deterministic,
          output_artifact_hash: execution.outputArtifactHash,
          artifact_available: execution.artifactAvailable,
          source_provenance: execution.sourceProvenance,
          provider_provenance: execution.providerProvenance,
        })),
        execution_count: node.executionCount,
        artifact_available: node.artifactAvailable,
        record_truncated: node.recordTruncated,
      },
      warnings: [],
    };
  } finally {
    await lease.release();
  }
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new PhotoctlError("usage", "--limit must be an integer between 1 and 100");
  }
  return limit;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
