import { databaseDescription, DEFAULT_CACHE_MAX_BYTES, initializeLibrary } from "@photoctl/library";
import { PhotoctlError, type Envelope, type InitData } from "@photoctl/protocol";
import { resolve } from "node:path";
import { parseArguments } from "../arguments.js";
import { parseByteSize } from "../byte-size.js";
import { libraryPath, type RequestEnv } from "../context.js";

export async function initCommand(args: string[], env: RequestEnv, cwd: string): Promise<Envelope> {
  const parsed = parseArguments(args, { options: ["--path", "--cache-max", "--embed"] });
  if (parsed.positionals.length > 0) {
    throw new PhotoctlError("usage", `Unexpected argument: ${parsed.positionals[0]}`);
  }
  const { options } = parsed;
  const pathOption = options.get("--path");
  const path = pathOption ? resolve(cwd, pathOption) : libraryPath(env, cwd);
  const cacheMax = options.get("--cache-max");
  const embed = options.get("--embed") ?? "manual";
  if (embed !== "auto" && embed !== "manual") {
    throw new PhotoctlError("usage", "--embed must be auto or manual");
  }
  const initialized = await initializeLibrary(
    path,
    cacheMax ? parseByteSize(cacheMax) : DEFAULT_CACHE_MAX_BYTES,
    embed,
  );
  try {
    return {
      schema: 1,
      ok: true,
      data: {
        library: initialized.handle.path,
        db: await databaseDescription(initialized.handle),
        cache_max_bytes: initialized.cacheMaxBytes,
        embed,
      } satisfies InitData,
      warnings: [],
    };
  } finally {
    await initialized.handle.close();
  }
}
