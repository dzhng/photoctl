import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import { createVolumeResolver, resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { resolveMacHelperPath } from "@photoctl/mac-helper";
import { PhotoctlError, type DecodeData, type Envelope, type Warning } from "@photoctl/protocol";
import {
  CirawDecoder,
  DecoderUnavailableError,
  FileImageDecoder,
  LibrawDecoder,
  selectDecoder,
  encodeLinearTiff,
  toSceneLinearRec2020,
  type DecodeScale,
  type ImageSource,
} from "@photoctl/render";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { fileDecodeSource, resolveOnlineOriginalSource } from "../image-source.js";
import { loadPhoto } from "../photo.js";

export async function decodeCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { options: ["--with", "--scale", "--to"] });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "decode requires exactly one photo ID or prefix");
  }
  const requested = parsed.options.get("--with") ?? "auto";
  if (!["auto", "file", "ciraw", "libraw"].includes(requested)) {
    throw new PhotoctlError("usage", "--with must be auto, file, ciraw, or libraw");
  }
  const scale = parseScale(parsed.options.get("--scale") ?? "1");
  const outputValue = parsed.options.get("--to");
  if (!outputValue) throw new PhotoctlError("usage", "decode requires --to <output.tif>");
  const output = resolve(cwd, outputValue);

  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  try {
    const id = await resolvePhotoId(handle, parsed.positionals[0]);
    const photo = await loadPhoto(handle, id);
    const resolver = createVolumeResolver(env.volumeMap);
    const original = await resolveOnlineOriginalSource(photo, resolver);
    const libraryId = await readLibraryId(handle);
    const pinned: ImageSource = {
      kind: "pinned-preview",
      path: pinnedEmbeddedJpegPath(cacheRootForLibrary(libraryId, cacheBase(env, cwd)), id),
      mediaType: "image/jpeg",
      orientation: 1,
    };
    const warnings: Warning[] = [];
    if (!original) {
      warnings.push({
        code: "source_offline",
        id,
        message: "Decoded the pinned preview because the original is offline",
      });
    }
    let selected;
    try {
      selected = await selectDecoder({
        requested: requested as "auto" | "file" | "ciraw" | "libraw",
        probe: original?.probe,
        original: original?.source,
        fallback: original ? (fileDecodeSource(photo, original) ?? pinned) : pinned,
        decoders: {
          file: new FileImageDecoder(),
          ciraw: new CirawDecoder(resolveMacHelperPath(env.macHelperPath)),
          libraw: new LibrawDecoder(),
        },
      });
    } catch (error) {
      if (error instanceof DecoderUnavailableError) {
        const code = requested === "ciraw" && !original ? "file_offline" : "decoder_unavailable";
        throw new PhotoctlError(code, error.message, { decoder: requested });
      }
      throw error;
    }
    if (selected.fellBack) {
      warnings.push({
        code: "decoder_fallback",
        id,
        message:
          "A full-resolution RAW decoder is unavailable; decoded the best file preview instead",
      });
    }
    let image;
    try {
      image = await selected.decoder.decode(selected.source, { scale });
    } catch (error) {
      if (error instanceof DecoderUnavailableError) {
        throw new PhotoctlError("decoder_unavailable", error.message, {
          decoder: selected.decoder.id,
        });
      }
      const code = selected.source.kind === "pinned-preview" ? "file_offline" : "unsupported_file";
      throw new PhotoctlError(code, "The selected image source could not be decoded", { id });
    }
    let encoded;
    let developed;
    try {
      developed = await toSceneLinearRec2020(image);
      encoded = await encodeLinearTiff(developed);
    } catch {
      throw new PhotoctlError(
        "decoder_unavailable",
        "The decoded image could not be developed or encoded",
        {
          decoder: selected.decoder.id,
        },
      );
    }
    try {
      await writeFile(output, encoded);
    } catch {
      throw new PhotoctlError("volume_readonly", `Could not write decoded TIFF: ${output}`, {
        path: output,
      });
    }
    return {
      schema: 1,
      ok: true,
      data: {
        id,
        decoder: selected.decoder.id,
        file: output,
        w: image.w,
        h: image.h,
        space: developed.space,
      } satisfies DecodeData,
      warnings,
    };
  } finally {
    await lease.release();
  }
}

function parseScale(value: string): DecodeScale {
  const scale = Number(value);
  if (scale !== 1 && scale !== 0.5 && scale !== 0.25) {
    throw new PhotoctlError("usage", "--scale must be 1, 0.5, or 0.25");
  }
  return scale;
}
