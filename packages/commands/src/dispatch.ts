import {
  PhotoctlError,
  type CommandRequest,
  type Envelope,
  type StderrEvent,
} from "@photoctl/protocol";
import type { LibraryHandle } from "@photoctl/library";
import type { PreviewCoordinator } from "@photoctl/render";
import { doctorCommand } from "./handlers/doctor.js";
import { initCommand } from "./handlers/init.js";
import { cacheCommand } from "./handlers/cache.js";
import { exportCommand } from "./handlers/export.js";
import { decodeCommand } from "./handlers/decode.js";
import { importCommand } from "./handlers/import.js";
import { showCommand } from "./handlers/show.js";
import { tagCommand } from "./handlers/tag.js";
import { backupCommand, migrateCommand, restoreCommand } from "./handlers/library-lifecycle.js";
import { graphCommand } from "./handlers/graph.js";
import { xmpCommand } from "./handlers/xmp.js";
import { developCommand, filterCommand, type DevelopDependencies } from "./handlers/develop.js";
import { historyCommand } from "./handlers/history.js";
import { cropCommand } from "./handlers/crop.js";
import { whiteBalanceCommand } from "./handlers/white-balance.js";
import { presetsCommand } from "./handlers/presets.js";
import { renderCommand } from "./handlers/render.js";
import { embedCommand } from "./handlers/embed.js";
import { searchCommand } from "./handlers/search.js";
import { segmentCommand, type SegmentationDependencies } from "./handlers/segment.js";
import { layerCommand } from "./handlers/layer.js";
import { fillCommand, type FillDependencies } from "./handlers/fill.js";
import { retouchCommand } from "./handlers/retouch.js";
import { reimagineCommand } from "./handlers/reimagine.js";
import { relightCommand } from "./handlers/relight.js";
import { generateCommand, type GenerateDependencies } from "./handlers/generate.js";
import { markupCommand } from "./handlers/markup.js";
import { settingsCommand } from "./handlers/settings.js";
import { configureCommand } from "./configure.js";
import {
  flagCommand,
  labelCommand,
  listCommand,
  nextCommand,
  removeCommand,
  rateCommand,
} from "./handlers/cull.js";
export interface DispatchContext {
  version: string;
  library?: LibraryHandle;
  emit?: (event: StderrEvent) => void | Promise<void>;
  stream?: (row: unknown) => void | Promise<void>;
  previewCoordinator?: PreviewCoordinator;
  segmentation?: SegmentationDependencies;
  segmenter?: import("@photoctl/render").Sam2Segmenter;
  fill?: FillDependencies;
  develop?: DevelopDependencies;
  generate?: GenerateDependencies;
}
export async function dispatch(
  request: CommandRequest,
  context: DispatchContext,
): Promise<Envelope> {
  try {
    if (request.verb === "configure")
      return await configureCommand(request.args, request.env.gatewayApiKey);
    if (request.verb === "version") {
      return { schema: 1, ok: true, data: { version: context.version }, warnings: [] };
    }
    if (request.verb === "settings")
      return await settingsCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "white_balance")
      return await whiteBalanceCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.emit,
      );
    if (request.verb === "crop")
      return await cropCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.emit,
      );
    if (request.verb === "import")
      return await importCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.emit,
      );
    if (request.verb === "show")
      return await showCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.previewCoordinator,
        context.emit,
      );
    if (request.verb === "cache")
      return await cacheCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.previewCoordinator,
      );
    if (request.verb === "export")
      return await exportCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.emit,
      );
    if (request.verb === "decode")
      return await decodeCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "graph")
      return await graphCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "xmp")
      return await xmpCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "undo" || request.verb === "redo")
      return await historyCommand(
        request.verb,
        request.args,
        request.env,
        request.cwd,
        context.library,
      );
    if (request.verb === "filter")
      return await filterCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "develop")
      return await developCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.develop,
        context.previewCoordinator,
      );
    if (request.verb === "presets")
      return await presetsCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "render")
      return await renderCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "embed")
      return await embedCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.emit,
      );
    if (request.verb === "search")
      return await searchCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.stream,
        context.emit,
      );
    if (request.verb === "segment")
      return await segmentCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.segmentation,
        context.segmenter,
        context.emit,
      );
    if (request.verb === "layer")
      return await layerCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
      );
    if (request.verb === "fill")
      return await fillCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
      );
    if (request.verb === "retouch")
      return await retouchCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "reimagine")
      return await reimagineCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
        context.emit,
      );
    if (request.verb === "relight")
      return await relightCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
        context.emit,
      );
    if (request.verb === "generate")
      return await generateCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.generate,
        context.emit,
      );
    if (request.verb === "markup")
      return await markupCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "tag")
      return await tagCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "list")
      return await listCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.stream,
      );
    if (request.verb === "next")
      return await nextCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "remove")
      return await removeCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "rate")
      return await rateCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "flag")
      return await flagCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "label")
      return await labelCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "backup")
      return await backupCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "restore")
      return await restoreCommand(request.args, request.env, request.cwd);
    if (request.verb === "migrate")
      return await migrateCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "init") return await initCommand(request.args, request.env, request.cwd);
    if (request.verb === "doctor")
      return await doctorCommand(
        request.args,
        request.env,
        request.cwd,
        context.version,
        context.library,
      );
    throw new PhotoctlError("usage", `Unknown command: ${request.verb}`);
  } catch (error) {
    if (error instanceof PhotoctlError)
      return {
        schema: 1,
        ok: false,
        code: error.code,
        data: error.data ?? { message: error.message },
      };
    throw error;
  }
}
