import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type Envelope, type PresetData } from "@photoctl/protocol";
import {
  developHash,
  listPresets,
  loadPreset,
  readActiveDevelopState,
  saveLibraryPreset,
} from "@photoctl/render";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";

export async function presetsCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const [action, ...rest] = args;
  if (!action || !["list", "show", "save"].includes(action))
    throw new PhotoctlError("usage", "presets requires list, show, or save");
  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  try {
    if (action === "list") {
      if (rest.length > 0) throw new PhotoctlError("usage", `Unexpected argument: ${rest[0]}`);
      return success({ presets: await listPresets(handle.path) });
    }
    if (action === "show") {
      if (rest.length !== 1) throw new PhotoctlError("usage", "presets show requires one name");
      return success(await presetData(rest[0], handle.path));
    }
    const parsed = parseArguments(rest, { options: ["--from"] });
    if (parsed.positionals.length !== 1)
      throw new PhotoctlError("usage", "presets save requires one name");
    const from = parsed.options.get("--from");
    if (!from) throw new PhotoctlError("usage", "presets save requires --from <photo-id>");
    const name = parsed.positionals[0];
    const id = await resolvePhotoId(handle, from);
    const photo = await loadPhoto(handle, id);
    const state = await readActiveDevelopState(handle, {
      photoId: id,
      orientation: photo.orientation,
    });
    return success(await saveLibraryPreset(handle.path, name, state.develop));
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    throw inputError(error);
  } finally {
    await lease.release();
  }
}

async function presetData(name: string, libraryPath: string): Promise<PresetData> {
  try {
    const preset = await loadPreset(name, libraryPath);
    return { ...preset, develop_hash: developHash(preset.develop) };
  } catch (error) {
    const converted = inputError(error);
    if (converted.message.startsWith("Preset not found:"))
      throw new PhotoctlError("not_found", converted.message, { name });
    throw converted;
  }
}

function success<T>(data: T): Envelope<T> {
  return { schema: 1, ok: true, data, warnings: [] };
}

function inputError(error: unknown): PhotoctlError {
  return new PhotoctlError("usage", error instanceof Error ? error.message : String(error));
}
