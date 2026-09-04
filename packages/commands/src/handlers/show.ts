import { PhotoctlError, type Envelope, type ShowData } from "@photoctl/protocol";
import { formatShotInstant } from "@photoctl/importer";
import { createVolumeResolver, resolvePhotoId } from "@photoctl/library";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";

export async function showCommand(args: string[], env: RequestEnv, cwd: string): Promise<Envelope> {
  const parsed = parseArguments(args, {});
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "show requires exactly one photo ID or prefix");
  }
  const handle = await openRequestLibrary(env, cwd);
  try {
    const id = await resolvePhotoId(handle, parsed.positionals[0]);
    const photo = await loadPhoto(handle, id);
    const resolver = createVolumeResolver(env.volumeMap);
    const locators = await Promise.all(
      photo.files.map(async (file) => ({
        volume: file.volumeUuid,
        path: file.relPath,
        online: (await resolver.resolve(file.volumeUuid, file.relPath)).online,
      })),
    );
    const data: ShowData = {
      id,
      dims: {
        w: photo.w,
        h: photo.h,
        orientation: photo.orientation,
        note: "oriented, uncropped — the coordinate space",
      },
      crop: null,
      camera: photo.camera,
      exposure: photo.exposure,
      shot:
        photo.shotAt && photo.shotOffsetMin !== null
          ? formatShotInstant(new Date(photo.shotAt), photo.shotOffsetMin)
          : null,
      rating: 0,
      flag: "none",
      label: null,
      tags: [],
      locators,
      content_key: photo.contentKey,
      develop: {},
      develop_hash: null,
      layers: { count: 0, stale: 0 },
      xmp: null,
    };
    return { schema: 1, ok: true, data, warnings: [] };
  } finally {
    await handle.close();
  }
}
