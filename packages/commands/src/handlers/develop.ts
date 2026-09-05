import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { isDeepStrictEqual } from "node:util";
import {
  applyDevelopMutation,
  commitDevelopState,
  developGeometryMatrix,
  developHash,
  loadPreset,
  readActiveDevelopState,
  RevisionConflictError,
  type DevelopDict,
  type JsonValue,
  type PreviewCoordinator,
} from "@photoctl/render";
import { PhotoctlError, type DevelopResult, type Envelope, type Warning } from "@photoctl/protocol";
import { batchEnvelope, batchFailure, resolveBatchInputs, type BatchFailure } from "../batch.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";
import {
  planAutoEnhance,
  readAutoEnhanceSnapshot,
  type DevelopDependencies,
} from "./develop-auto.js";

interface ParsedDevelop {
  ids: string[];
  preset?: string;
  copyFrom?: string;
  set: string[];
  unset: string[];
  reset: boolean;
  autoEnhance: boolean;
  undoAuto: boolean;
}

export type { DevelopDependencies } from "./develop-auto.js";

export async function developCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  dependencies?: DevelopDependencies,
  previewCoordinator?: PreviewCoordinator,
): Promise<Envelope> {
  const parsed = parseDevelopArguments(args);
  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  try {
    let preset: { name: string; develop: DevelopDict } | undefined;
    if (parsed.preset) {
      try {
        preset = {
          name: parsed.preset,
          develop: (await loadPreset(parsed.preset, handle.path)).develop,
        };
      } catch (error) {
        throw commandInputError(error);
      }
    }
    let copiedDevelop: DevelopDict | undefined;
    if (parsed.copyFrom) {
      const sourceId = await resolvePhotoId(handle, parsed.copyFrom);
      const source = await loadPhoto(handle, sourceId);
      copiedDevelop = (
        await readActiveDevelopState(handle, {
          photoId: sourceId,
          orientation: source.orientation,
        })
      ).develop;
    }

    const resolved = await resolveBatchInputs(handle, parsed.ids);
    const results: Array<DevelopResult | BatchFailure> = [];
    const warnings: Warning[] = [];
    for (const item of resolved) {
      if (!item.ok) {
        results.push(item);
        continue;
      }
      try {
        const photo = await loadPhoto(handle, item.id);
        const current = await readActiveDevelopState(handle, {
          photoId: item.id,
          orientation: photo.orientation,
        });
        const base = parsed.copyFrom ? copiedDevelop : current.develop;
        if (!base) throw new Error("copy source develop state was not loaded");
        let next: DevelopDict;
        let revisionMetadata: Record<string, JsonValue> | undefined;
        try {
          if (parsed.undoAuto) {
            next = readAutoEnhanceSnapshot(current.revisionMetadata, item.id);
          } else if (parsed.autoEnhance) {
            const planned = await planAutoEnhance({
              id: item.id,
              current: base,
              handle,
              env,
              cwd,
              previewCoordinator,
              ...(dependencies ? { dependencies } : {}),
            });
            next = planned.develop;
            revisionMetadata = planned.metadata;
            for (const warning of planned.warnings) pushWarning(warnings, warning);
          } else {
            next = applyDevelopMutation(base, {
              preset,
              set: parsed.set,
              unset: parsed.unset,
              reset: parsed.reset,
            });
          }
          developGeometryMatrix(photo.w, photo.h, next);
        } catch (error) {
          throw commandInputError(error);
        }
        const committed =
          isDeepStrictEqual(next, current.develop) &&
          revisionMetadata === undefined &&
          !parsed.undoAuto
            ? null
            : await commitDevelopState(handle, current, next, revisionMetadata);
        const layers = committed?.layers ?? { deltaApplied: [], stale: [] };
        if (layers.stale.length > 0) {
          pushWarning(warnings, {
            code: "layers_stale",
            id: item.id,
            message: `${layers.stale.length} ${layers.stale.length === 1 ? "layer is" : "layers are"} stale after the develop change`,
          });
        }
        results.push({
          id: item.id,
          ok: true,
          develop_hash: developHash(next),
          render_hash: committed?.renderHash ?? current.renderHash,
          layers: { delta_applied: layers.deltaApplied, stale: layers.stale },
        });
      } catch (error) {
        results.push(batchFailure(item.id, normalizeDevelopItemError(error, item.id)));
      }
    }
    return batchEnvelope(results, warnings);
  } finally {
    await lease.release();
  }
}

function pushWarning(warnings: Warning[], warning: Warning): void {
  if (!warnings.some(({ code, id }) => code === warning.code && id === warning.id)) {
    warnings.push(warning);
  }
}

function parseDevelopArguments(args: string[]): ParsedDevelop {
  const parsed: ParsedDevelop = {
    ids: [],
    set: [],
    unset: [],
    reset: false,
    autoEnhance: false,
    undoAuto: false,
  };
  let index = 0;
  while (index < args.length && !args[index].startsWith("--")) parsed.ids.push(args[index++]);
  while (index < args.length) {
    const option = args[index++];
    if (option === "--reset" || option === "--auto-enhance" || option === "--undo-auto") {
      const field =
        option === "--reset" ? "reset" : option === "--auto-enhance" ? "autoEnhance" : "undoAuto";
      if (parsed[field]) throw new PhotoctlError("usage", `Duplicate option: ${option}`);
      parsed[field] = true;
      continue;
    }
    if (option === "--preset" || option === "--copy-from") {
      const value = args[index++];
      if (!value || value.startsWith("--"))
        throw new PhotoctlError("usage", `${option} requires a value`);
      const field = option === "--preset" ? "preset" : "copyFrom";
      if (parsed[field]) throw new PhotoctlError("usage", `Duplicate option: ${option}`);
      parsed[field] = value;
      continue;
    }
    if (option === "--set" || option === "--unset") {
      const values: string[] = [];
      while (index < args.length && !args[index].startsWith("--")) values.push(args[index++]);
      if (values.length === 0) throw new PhotoctlError("usage", `${option} requires a value`);
      (option === "--set" ? parsed.set : parsed.unset).push(...values);
      continue;
    }
    throw new PhotoctlError("usage", `Unexpected argument: ${option}`);
  }
  if (parsed.ids.length === 0)
    throw new PhotoctlError("usage", "develop requires at least one photo ID");
  if (
    !parsed.copyFrom &&
    !parsed.preset &&
    !parsed.reset &&
    parsed.set.length === 0 &&
    parsed.unset.length === 0 &&
    !parsed.autoEnhance &&
    !parsed.undoAuto
  )
    throw new PhotoctlError("usage", "develop requires a mutation");
  const automaticModes = Number(parsed.autoEnhance) + Number(parsed.undoAuto);
  const manualMutation =
    Boolean(parsed.copyFrom) ||
    Boolean(parsed.preset) ||
    parsed.reset ||
    parsed.set.length > 0 ||
    parsed.unset.length > 0;
  if (automaticModes > 1 || (automaticModes === 1 && manualMutation)) {
    throw new PhotoctlError(
      "usage",
      "--auto-enhance and --undo-auto must be used as standalone develop mutations",
    );
  }
  return parsed;
}

function commandInputError(error: unknown): PhotoctlError {
  if (error instanceof PhotoctlError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PhotoctlError(
    message.startsWith("Preset not found:") ? "not_found" : "usage",
    message,
  );
}

function normalizeDevelopItemError(error: unknown, id: string): PhotoctlError {
  if (error instanceof PhotoctlError) return error;
  if (error instanceof RevisionConflictError) {
    return new PhotoctlError("library_locked", error.message, {
      id,
      reason: "revision_conflict",
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new PhotoctlError("catalog_unreadable", "Could not read or commit develop state", {
    id,
    reason: message,
  });
}
