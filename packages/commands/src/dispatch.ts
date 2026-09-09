import {
  PhotoctlError,
  type CommandRequest,
  type Envelope,
  type StderrEvent,
} from "@photoctl/protocol";
import { modelSourceBaseUrl, PINNED_MODEL_RELEASE, type LibraryHandle } from "@photoctl/library";
import { DEVELOP_FILTER_NAMES, DEVELOP_OPERATORS, type PreviewCoordinator } from "@photoctl/render";
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
  segmenter?: import("@photoctl/render").ZimSegmenter;
  fill?: FillDependencies;
  develop?: DevelopDependencies;
  generate?: GenerateDependencies;
}
interface CommandDefinition {
  description: string;
  usage: string;
  notes?: string[];
  examples: string[];
  subcommands?: Record<string, string>;
  handlerHelp?: boolean;
  run?: (request: CommandRequest, context: DispatchContext) => Envelope | Promise<Envelope>;
}

// Execution adapters and discovery share one inventory. Handler parsers still validate execution.
const commands: Record<string, CommandDefinition> = {
  configure: {
    description: "Save gateway credentials separately from photo libraries",
    usage: "openphoto configure [--key-stdin | --from-env]",
    examples: ["openphoto configure"],
    handlerHelp: true,
    run: async (request) => configureCommand(request.args, request.env.gatewayApiKey),
  },
  settings: {
    description: "Inspect or replace library settings",
    usage: "openphoto settings get [key] | set <key> <json> | reset <key>",
    subcommands: {
      get: "get [key]: inspect one key or every setting",
      set: "set <key> <json>: replace the entire value with shell-quoted JSON",
      reset: "reset <key>: restore its user default",
    },
    examples: [
      "openphoto settings get",
      "openphoto settings set models_base_url '\"https://models.example.com/pinned/\"'",
      "openphoto settings reset models_base_url",
    ],
    handlerHelp: true,
    run: async (request, context) =>
      settingsCommand(request.args, request.env, request.cwd, context.library),
  },
  white_balance: {
    description: "Sample a neutral point or region to set white balance",
    usage: "openphoto white_balance PHOTO (--point x,y | --region x,y,w,h) [--norm]",
    notes: ["Provide exactly one sample. --norm uses fractions of the command's coordinate frame."],
    examples: ["openphoto white_balance PHOTO --point 0.5,0.5 --norm"],
    run: async (request, context) =>
      whiteBalanceCommand(request.args, request.env, request.cwd, context.library, context.emit),
  },
  crop: {
    description: "Set crop aspect or straighten, or request automatic crop",
    usage: "openphoto crop PHOTO [--aspect W:H] [--straighten DEGREES] [--auto]",
    notes: [
      "Provide at least one crop option. --auto uses the configured model for a crop proposal and cannot combine with --straighten.",
    ],
    examples: ["openphoto crop PHOTO --aspect 4:5"],
    run: async (request, context) =>
      cropCommand(request.args, request.env, request.cwd, context.library, context.emit),
  },
  import: {
    description: "Register originals by linking or copying them into the library",
    usage:
      "openphoto import FILE_OR_FOLDER (--link | --copy) [--recursive] [--companions paired|raw|jpeg|both]",
    notes: [
      "Choose exactly one of --link (keep the source in place) or --copy (library-owned copy). --companions controls RAW/JPEG pairing.",
    ],
    examples: ["openphoto import ./photos --link --recursive"],
    run: async (request, context) =>
      importCommand(request.args, request.env, request.cwd, context.library, context.emit),
  },
  show: {
    description: "Inspect a photo and materialize its preview",
    usage:
      "openphoto show PHOTO_ID_OR_PATH [--preview-size PIXELS|native] [--region x,y,w,h [--norm]] [--source camera-jpeg]",
    notes: [
      "IDs accept unambiguous prefixes; show also accepts a registered file path. --norm makes region coordinates fractions. The response reports preview location, dimensions and coordinate transforms. --source camera-jpeg requests the camera rendition.",
    ],
    examples: ["openphoto show PHOTO --preview-size 1600"],
    run: async (request, context) =>
      showCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.previewCoordinator,
        context.emit,
      ),
  },
  cache: {
    description: "Prune regenerable cached artifacts",
    usage: "openphoto cache prune [--max BYTES]",
    subcommands: { prune: "prune [--max BYTES]: prune to the supplied size or library setting" },
    examples: ["openphoto cache prune --max 2GiB"],
    run: async (request, context) =>
      cacheCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.previewCoordinator,
      ),
  },
  export: {
    description: "Deliver rendered photos to a directory",
    usage:
      "openphoto export PHOTO... --to DIRECTORY [--format jpeg|png|tiff] [--quality 1..100] [--resize PIXELS] [--template TEMPLATE] [--on-collision skip|overwrite|rename] [--preset NAME] [--iptc creator=TEXT] [--iptc copyright=TEXT] [--source camera-jpeg]",
    notes: [
      "--resize limits the long edge. Repeat --iptc for creator and copyright. --source camera-jpeg requests the camera rendition. Export options may also come from a named export preset. Templates support {stem}, {id8}, {rating}, {date}, {seq} and {seq:N}; {date} requires a photographed shot-local date.",
    ],
    examples: [
      "openphoto export PHOTO --to ./delivery --format jpeg --quality 95 --on-collision rename",
    ],
    run: async (request, context) =>
      exportCommand(request.args, request.env, request.cwd, context.library, context.emit),
  },
  decode: {
    description: "Decode a source into linear TIFF for inspection",
    usage:
      "openphoto decode PHOTO --to OUTPUT.tif [--with auto|file|ciraw|libraw] [--scale 1|0.5|0.25] [--highlight-reconstruction disabled|reconstruct]",
    notes: [
      "Default decoder selection is auto. Inspect warnings for preview fallback when originals or decoders are unavailable.",
    ],
    examples: ["openphoto decode PHOTO --with auto --to ./decoded.tif"],
    run: async (request, context) =>
      decodeCommand(request.args, request.env, request.cwd, context.library),
  },
  graph: {
    description: "Inspect retained image graph and generation attempts",
    usage: "openphoto graph show|node|attempts|attempt [arguments]",
    subcommands: {
      show: "show PHOTO [--history] [--layer LAYER] [--limit N] [--cursor CURSOR]",
      node: "node PHOTO NODE_ID: inspect a full node_<64 hex> identity",
      attempts:
        "attempts [--limit N] [--cursor CURSOR]: list generation attempts across the library",
      attempt: "attempt ATTEMPT_UUID: inspect one generation attempt",
    },
    examples: [
      "openphoto graph show PHOTO --history",
      "openphoto graph node PHOTO NODE_ID",
      "openphoto graph attempts --limit 10",
      "openphoto graph attempt ATTEMPT_UUID",
    ],
    run: async (request, context) =>
      graphCommand(request.args, request.env, request.cwd, context.library),
  },
  xmp: {
    description: "Explicitly write or read metadata beside originals",
    usage: "openphoto xmp write PHOTO... | sync PHOTO... --read",
    subcommands: {
      write: "write PHOTO...: publish catalog metadata to XMP sidecars",
      sync: "sync PHOTO... --read: read changed sidecar metadata",
    },
    examples: ["openphoto xmp write PHOTO", "openphoto xmp sync PHOTO --read"],
    run: async (request, context) =>
      xmpCommand(request.args, request.env, request.cwd, context.library),
  },
  filter: {
    description: "Apply a named look at a chosen strength",
    notes: [`Names: ${DEVELOP_FILTER_NAMES.join(", ")}. Strength is between 0 and 1.`],
    usage: "openphoto filter PHOTO --name NAME --strength NUMBER",
    examples: ["openphoto filter PHOTO --name vivid --strength 0.5"],
    run: async (request, context) =>
      filterCommand(request.args, request.env, request.cwd, context.library),
  },
  develop: {
    description: "Change nondestructive development settings",
    usage:
      "openphoto develop PHOTO... [--set key=value...] [--unset key...] [--reset] [--preset NAME] [--copy-from PHOTO] | openphoto develop PHOTO... (--auto-enhance | --undo-auto)",
    notes: [
      `Development keys: ${Object.entries(DEVELOP_OPERATORS)
        .map(([key, value]) => `${key}${value.range ? ` (${value.range.join("..")})` : ""}`)
        .join(", ")}.`,
      "Structured values use shell-quoted JSON: curves has rgb/red/green/blue arrays of [input,output] points; levels has black/midpoint/white; crop has x/y/w/h; selective_color maps color bands to hue/saturation/luminance adjustments. Rotate is 0, 90, 180 or 270; aspect_ratio is W:H. --preset selects a saved preset.",
      "Put all photo IDs before options. --set accepts typed development key=value values, including dotted controls. --unset removes overrides; --reset resets development. --auto-enhance and --undo-auto must each be used alone, without manual mutations.",
    ],
    examples: [
      "openphoto develop PHOTO --set exposure=0.5",
      "openphoto develop PHOTO --auto-enhance",
    ],
    run: async (request, context) =>
      developCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.develop,
        context.previewCoordinator,
      ),
  },
  presets: {
    description: "Inspect and save development presets",
    usage: "openphoto presets list | show NAME | save NAME --from PHOTO",
    subcommands: {
      list: "list: list available presets",
      show: "show NAME: inspect preset values",
      save: "save NAME --from PHOTO: save the photo's development values",
    },
    examples: [
      "openphoto presets list",
      "openphoto presets show portrait",
      "openphoto presets save portrait --from PHOTO",
    ],
    run: async (request, context) =>
      presetsCommand(request.args, request.env, request.cwd, context.library),
  },
  render: {
    description: "Write the edited linear image as TIFF",
    usage: "openphoto render PHOTO --linear --to OUTPUT.tif",
    examples: ["openphoto render PHOTO --linear --to ./linear.tif"],
    run: async (request, context) =>
      renderCommand(request.args, request.env, request.cwd, context.library),
  },
  embed: {
    description: "Request embeddings for selected or all photos",
    usage: "openphoto embed (PHOTO... | --all)",
    notes: [
      "Explicit provider work; requires gateway configuration. Existing embeddings support semantic search.",
    ],
    examples: ["openphoto embed --all"],
    run: async (request, context) =>
      embedCommand(request.args, request.env, request.cwd, context.library, context.emit),
  },
  search: {
    description: "Search photos using semantic embeddings",
    usage: "openphoto search QUERY... [--limit N] [--stream]",
    notes: [
      "Requires a configured embedding provider for the query. --stream emits JSON hits individually.",
    ],
    examples: ["openphoto search 'person by a window' --limit 10"],
    run: async (request, context) =>
      searchCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.stream,
        context.emit,
      ),
  },
  segment: {
    description: "Create a selection from points, text or manual shapes",
    usage:
      "openphoto segment PHOTO [--at x,y ...] [--text DESCRIPTION] [--box x,y,w,h] [--brush JSON] [--norm] [--dry-run] [--layer LAYER --operation add|subtract|replace]",
    notes: [
      "--at is repeatable: point-only prompts run local ZIM. --text describes the target; combined --text and --at use the click to choose the intended instance, rather than changing the requested semantic scope. Text grounding requires a configured gateway as well as local models.",
      "Coordinates are oriented, uncropped image pixels before development crop/rotation, not arbitrary preview pixels; use show's reported transforms to map a displayed click. --norm interprets coordinates as fractions of that logical frame. Inspect returned coordinate metadata rather than assuming preview size equals source size.",
      "--box alone creates a manual rectangle. --box with --at constrains model segmentation. --brush is a JSON polygon of [x,y] points and cannot combine with model prompts. --text cannot combine with --box.",
      "--dry-run resolves model candidates without creating a layer; it requires --at or --text and can still perform model/provider work. No match and ambiguous instances are reported explicitly; refine the description or add a click. Successful execution is not proof of mask quality.",
      "Manual refinement requires both --layer and --operation, plus exactly one --box or --brush, and no --at or --text. Preview the resulting layer before using it for an edit.",
    ],
    examples: [
      "openphoto segment PHOTO --at 0.45,0.35 --norm",
      "openphoto segment PHOTO --text 'whole person including hair and clothing, excluding the bouquet' --at 0.45,0.35 --norm --dry-run",
      "openphoto segment PHOTO --text 'whole person including hair and clothing, excluding the bouquet' --at 0.45,0.35 --norm",
      "openphoto segment PHOTO --at 100,120 --at 110,180 --box 50,50,250,400",
      "openphoto segment PHOTO --box 0.1,0.1,0.3,0.5 --norm",
      "openphoto segment PHOTO --layer LAYER --operation subtract --brush '[[10,10],[50,10],[50,50]]'",
    ],
    run: async (request, context) =>
      segmentCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.segmentation,
        context.segmenter,
        context.emit,
      ),
  },
  layer: {
    description: "Inspect, transform and manage editing layers",
    usage: "openphoto layer ACTION PHOTO [LAYER] [options]",
    notes: [
      "Transform replaces placement by default; --relative composes with current placement. --norm uses image fractions for translation and explicit anchor coordinates. --flip accepts h, v, both or none. Scale must be positive. --enabled is true or false; --opacity is between 0 and 1.",
    ],
    subcommands: {
      list: "list PHOTO: list layers",
      show: "show PHOTO LAYER: inspect one layer",
      transform:
        "transform PHOTO LAYER [--dx X] [--dy Y] [--scale N] [--rotate DEGREES] [--flip h|v|both|none] [--anchor centroid|x,y] [--relative] [--norm]",
      reorder: "reorder PHOTO LAYER (--up | --down | --front | --back | --to INDEX)",
      set: "set PHOTO LAYER [--name NAME] [--opacity N] [--blend MODE] [--enabled true|false]",
      duplicate: "duplicate PHOTO LAYER: duplicate a layer",
      remove: "remove PHOTO LAYER: remove a layer",
      clear: "clear PHOTO: remove all layers",
      refresh: "refresh PHOTO LAYER [--from NODE]: regenerate from the generation or upscale node",
    },
    examples: [
      "openphoto layer list PHOTO",
      "openphoto layer show PHOTO LAYER",
      "openphoto layer transform PHOTO LAYER --dx 10 --dy 20 --relative",
      "openphoto layer reorder PHOTO LAYER --front",
      "openphoto layer set PHOTO LAYER --opacity 0.5",
      "openphoto layer duplicate PHOTO LAYER",
      "openphoto layer remove PHOTO LAYER",
      "openphoto layer clear PHOTO",
      "openphoto layer refresh PHOTO LAYER",
    ],
    run: async (request, context) =>
      layerCommand(request.args, request.env, request.cwd, context.library, context.fill),
  },
  fill: {
    description: "Generate within a selection, move a subject, or expand the canvas",
    usage:
      "openphoto fill PHOTO --layer LAYER (--remove | --prompt TEXT) [generation options] | openphoto fill PHOTO --move LAYER (--to x,y | --by dx,dy) [--scale N] [--norm] | openphoto fill PHOTO --outpaint (--px N | --aspect W:H) --prompt TEXT [generation options]",
    notes: [
      "Generation controls: --pad N, --fit strict|expand=N|free, --strength 0..1 (mask feather), --ref PATH, --init original|fill|noise|empty, --seed INTEGER, --model ID, --upscale-model ID, --upscale or --no-upscale, --full-res. Movement accepts --norm and cannot combine with generation controls. Outpaint expansion requires exactly one of --px or --aspect and cannot combine with --layer, --remove, --fit, --strength or --pad. Model capability validation may reject unsupported controls.",
    ],
    examples: [
      "openphoto fill PHOTO --layer LAYER --remove",
      "openphoto fill PHOTO --layer LAYER --prompt 'a red jacket'",
      "openphoto fill PHOTO --outpaint --px 200 --prompt 'continue the scene'",
    ],
    run: async (request, context) =>
      fillCommand(request.args, request.env, request.cwd, context.library, context.fill),
  },
  retouch: {
    description: "Apply local deterministic spot repair",
    usage: "openphoto retouch PHOTO --at x,y [--radius N] [--norm]",
    examples: ["openphoto retouch PHOTO --at 100,120 --radius 8"],
    run: async (request, context) =>
      retouchCommand(request.args, request.env, request.cwd, context.library),
  },
  reimagine: {
    description: "Generate a new interpretation of the photo",
    usage:
      "openphoto reimagine PHOTO --prompt TEXT [--strength N] [--upscale | --no-upscale] [--upscale-model ID]",
    examples: ["openphoto reimagine PHOTO --prompt 'soft evening light' --strength 0.3"],
    run: async (request, context) =>
      reimagineCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
        context.emit,
      ),
  },
  relight: {
    description: "Request directional relighting",
    usage:
      "openphoto relight PHOTO --azimuth DEGREES --elevation DEGREES --intensity N [--upscale | --no-upscale] [--upscale-model ID]",
    examples: ["openphoto relight PHOTO --azimuth 45 --elevation 30 --intensity 0.5"],
    run: async (request, context) =>
      relightCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
        context.emit,
      ),
  },
  generate: {
    description: "Generate and import an image, optionally using a reference",
    usage:
      "openphoto generate [--prompt TEXT] [--ref PATH] [--size WxH] [--seed INTEGER] [--model ID] [--neg TEXT] [--strength 0..1] [--upscale | --no-upscale] [--upscale-model ID]",
    notes: [
      "Requires --prompt or --ref. --strength requires --ref. Provider capabilities determine support for individual controls.",
    ],
    examples: ["openphoto generate --prompt 'a mountain at dawn' --size 1024x1024"],
    run: async (request, context) =>
      generateCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.generate,
        context.emit,
      ),
  },
  markup: {
    description: "Add vector annotations to a photo",
    usage: "openphoto markup ACTION PHOTO [ITEM] [--json JSON]",
    subcommands: {
      list: "list PHOTO: inspect annotations",
      add: "add PHOTO --json JSON: add one primitive",
      update: "update PHOTO ITEM --json JSON: replace a primitive",
      remove: "remove PHOTO ITEM: remove one primitive",
      clear: "clear PHOTO: remove all annotations",
    },
    notes: [
      "Primitives: text {at,text,size_px,color}; arrow/line {from,to,width,color}; rect/ellipse {bbox,width,color,fill?}; path {points,width,color}; highlight {bbox,color,opacity}. Include type in every JSON object. Coordinates are pixels and colors are #RRGGBB or #RRGGBBAA.",
    ],
    examples: [
      "openphoto markup list PHOTO",
      'openphoto markup add PHOTO --json \'{"type":"text","at":[20,30],"text":"Proof","size_px":24,"color":"#ffffff"}\'',
      'openphoto markup update PHOTO ITEM --json \'{"type":"text","at":[20,30],"text":"Final","size_px":24,"color":"#ffffff"}\'',
      "openphoto markup remove PHOTO ITEM",
      "openphoto markup clear PHOTO",
    ],
    run: async (request, context) =>
      markupCommand(request.args, request.env, request.cwd, context.library),
  },
  tag: {
    description: "Add or remove a tag on photos",
    usage: "openphoto tag PHOTO... (--add TAG | --remove TAG)",
    examples: ["openphoto tag PHOTO --add portrait"],
    run: async (request, context) =>
      tagCommand(request.args, request.env, request.cwd, context.library),
  },
  list: {
    description: "List and filter catalog photos",
    usage:
      "openphoto list [--rating FILTER] [--flag pick|reject|none] [--label COLOR|none] [--tag TAG] [--folder PATH] [--limit N] [--xmp-stale] [--stream]",
    notes: [
      "Quote rating comparisons such as '>=3'. Colors: red, yellow, green, blue, purple. --stream writes one JSON row per line; stderr remains events.",
    ],
    examples: ["openphoto list --rating '>=3' --flag pick"],
    run: async (request, context) =>
      listCommand(request.args, request.env, request.cwd, context.library, context.stream),
  },
  next: {
    description: "Advance the culling cursor",
    usage: "openphoto next [--unrated] [--unflagged] [--folder PATH] [--reset]",
    notes: ["--reset restarts the cursor; filters restrict eligible photos."],
    examples: ["openphoto next --unrated"],
    run: async (request, context) =>
      nextCommand(request.args, request.env, request.cwd, context.library),
  },
  remove: {
    description: "Remove photos from the catalog, optionally their files",
    usage: "openphoto remove PHOTO... [--from-disk] [--yes]",
    notes: [
      "Several photos require --yes. --from-disk also requires --yes and deletes original files; omit it to retain files.",
    ],
    examples: ["openphoto remove PHOTO"],
    run: async (request, context) =>
      removeCommand(request.args, request.env, request.cwd, context.library),
  },
  rate: {
    description: "Set star ratings for photos",
    usage: "openphoto rate PHOTO... --stars 0..5",
    examples: ["openphoto rate PHOTO --stars 5"],
    run: async (request, context) =>
      rateCommand(request.args, request.env, request.cwd, context.library),
  },
  flag: {
    description: "Set pick, reject or no flag on photos",
    usage: "openphoto flag PHOTO... (--pick | --reject | --none)",
    examples: ["openphoto flag PHOTO --pick"],
    run: async (request, context) =>
      flagCommand(request.args, request.env, request.cwd, context.library),
  },
  label: {
    description: "Set a color label on photos",
    usage: "openphoto label PHOTO... red|yellow|green|blue|purple|none",
    examples: ["openphoto label PHOTO blue"],
    run: async (request, context) =>
      labelCommand(request.args, request.env, request.cwd, context.library),
  },
  backup: {
    description: "Create a catalog backup",
    usage: "openphoto backup",
    notes: [
      "Backs up library state; do not treat it as a backup of externally linked original files.",
    ],
    examples: ["openphoto backup"],
    run: async (request, context) =>
      backupCommand(request.args, request.env, request.cwd, context.library),
  },
  restore: {
    description: "Restore library state from a backup",
    usage: "openphoto restore [--from BACKUP] [--path LIBRARY]",
    notes: [
      "Stops the selected library daemon before restore. Without --from, uses the library's default backup selection.",
    ],
    examples: ["openphoto restore --path ./library --from ./backup"],
    run: async (request) => restoreCommand(request.args, request.env, request.cwd),
  },
  migrate: {
    description: "Apply pending catalog schema migrations",
    usage: "openphoto migrate",
    examples: ["openphoto migrate"],
    run: async (request, context) =>
      migrateCommand(request.args, request.env, request.cwd, context.library),
  },
  init: {
    description: "Create a photo library",
    usage: "openphoto init [--path DIRECTORY] [--cache-max BYTES] [--embed manual|auto]",
    notes: [
      "Embedding defaults to manual. Auto permits background provider embedding. Sizes use B, KiB, MiB, GiB or TiB, for example --cache-max 2GiB.",
    ],
    examples: ["openphoto init --path ./library --embed manual"],
    run: async (request) => initCommand(request.args, request.env, request.cwd),
  },
  doctor: {
    description: "Inspect runtime, providers, storage and pinned local models",
    usage: "openphoto doctor [--fetch-models]",
    notes: [
      "Without --fetch-models, inspect model hashes without downloading. --fetch-models explicitly downloads pinned ZIM artifacts into the selected library's models directory. Verified cached files are reused; missing or invalid files are fetched again, SHA-256 checked, and atomically installed. Temporary files are cleaned after failure; retry the same command.",
      `The default source is the official NAVER repository on Hugging Face at a pinned revision: ${modelSourceBaseUrl(PINNED_MODEL_RELEASE)}. settings set models_base_url selects a mirror; saving that setting does not download. Model license and notice files accompany the artifacts. Installation and ordinary segmentation do not fetch models. Local ZIM supports points; text grounding also requires gateway credentials.`,
    ],
    examples: [
      "openphoto doctor --fetch-models",
      "openphoto settings set models_base_url '\"https://models.example.com/pinned/\"'",
      "openphoto settings reset models_base_url",
    ],
    run: async (request, context) =>
      doctorCommand(request.args, request.env, request.cwd, context.library),
  },
  undo: {
    description: "Restore the previous editing state",
    usage: "openphoto undo PHOTO",
    examples: ["openphoto undo PHOTO"],
    run: async (request, context) =>
      historyCommand("undo", request.args, request.env, request.cwd, context.library),
  },
  redo: {
    description: "Reapply an undone editing state",
    usage: "openphoto redo PHOTO",
    examples: ["openphoto redo PHOTO"],
    run: async (request, context) =>
      historyCommand("redo", request.args, request.env, request.cwd, context.library),
  },
  version: {
    description: "Report the installed CLI version",
    usage: "openphoto version | --version | -V",
    examples: ["openphoto --version"],
    run: async (request, context) => ({
      schema: 1,
      ok: true,
      data: { version: context.version },
      warnings: [],
    }),
  },
  daemon: {
    description: "Start, stop or inspect the selected library daemon",
    usage: "openphoto daemon start|stop|status",
    subcommands: {
      start: "start: start or connect to the library daemon",
      stop: "stop: stop the library daemon",
      status: "status: inspect a running daemon",
    },
    examples: ["openphoto daemon start", "openphoto daemon status", "openphoto daemon stop"],
    // Daemon control belongs to the execution transport; it is never sent to daemon dispatch.
  },
};

export function isHelpRequest(request: Pick<CommandRequest, "verb" | "args">): boolean {
  return (
    request.verb === "" ||
    request.verb === "help" ||
    request.verb === "--help" ||
    request.args.includes("--help")
  );
}

async function help(request: CommandRequest, context: DispatchContext): Promise<Envelope> {
  const root = request.verb === "" || request.verb === "help" || request.verb === "--help";
  const targets = (root ? request.args : [request.verb, ...request.args]).filter(
    (argument) => argument !== "--help",
  );
  const [command, subcommand] = targets;
  if (!command) {
    return {
      schema: 1,
      ok: true,
      warnings: [],
      data: {
        usage: "openphoto COMMAND [arguments] [--human] [--no-daemon]",
        description:
          "A CLI-first photo library and nondestructive editor. Use openphoto help COMMAND or openphoto COMMAND --help for usage and examples.",
        commands: Object.entries(commands).map(([name, definition]) => ({
          command: name,
          description: definition.description,
        })),
        notes: [
          "Default stdout is a schema-1 JSON envelope; stderr carries JSON events. --human renders readable output. --no-daemon executes directly. PHOTOCTL_LIBRARY chooses a library; PHOTOCTL_CACHE chooses its cache root. Help makes no library, credential or network request.",
        ],
        examples: [
          "openphoto init --path ./library",
          "openphoto help segment",
          "openphoto layer transform --help --human",
        ],
      },
    };
  }
  const definition = Object.hasOwn(commands, command) ? commands[command] : undefined;
  if (!definition)
    throw new PhotoctlError(
      "usage",
      `Unknown help target: ${command}. Use openphoto help to list commands.`,
    );
  if (root && targets.length > 2)
    throw new PhotoctlError("usage", `Unexpected help argument: ${targets[2]}`);
  if (subcommand && definition.subcommands) {
    const usage = Object.hasOwn(definition.subcommands, subcommand)
      ? definition.subcommands[subcommand]
      : undefined;
    if (!usage)
      throw new PhotoctlError(
        "usage",
        `Unknown help target: ${command} ${subcommand}. Use openphoto help ${command}.`,
      );
    return {
      schema: 1,
      ok: true,
      warnings: [],
      data: {
        usage: `openphoto ${command} ${usage}`,
        description: definition.description,
        notes: definition.notes ?? [],
        examples: definition.examples.filter(
          (example) =>
            example === `openphoto ${command} ${subcommand}` ||
            example.startsWith(`openphoto ${command} ${subcommand} `),
        ),
      },
    };
  }
  if (root && targets.length > 1)
    throw new PhotoctlError("usage", `Unexpected help argument: ${subcommand}`);
  if (definition.handlerHelp)
    return await definition.run!({ ...request, verb: command, args: ["--help"] }, context);
  const { usage, description, notes, examples, subcommands } = definition;
  return {
    schema: 1,
    ok: true,
    warnings: [],
    data: { usage, description, notes, examples, subcommands },
  };
}

export async function dispatch(
  request: CommandRequest,
  context: DispatchContext,
): Promise<Envelope> {
  try {
    if (isHelpRequest(request)) return await help(request, context);
    const definition = Object.hasOwn(commands, request.verb) ? commands[request.verb] : undefined;
    if (!definition?.run) throw new PhotoctlError("usage", `Unknown command: ${request.verb}`);
    return await definition.run(request, context);
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
