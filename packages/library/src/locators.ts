import { execFile } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import { access, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";
import { promisify } from "node:util";
import { PhotoctlError } from "@photoctl/protocol";

export interface VolumeLocation {
  uuid: string;
  label: string | null;
  mount: string;
  relPath: string;
  online: boolean;
}

export interface ResolvedLocator {
  mount: string | null;
  path: string | null;
  online: boolean;
}

export interface VolumeResolver {
  locate(path: string): Promise<VolumeLocation>;
  resolve(volumeUuid: string, relPath: string): Promise<ResolvedLocator>;
}

export const LIBRARY_VOLUME_UUID = "photoctl-library";

export function createVolumeResolver(
  mapping = process.env.PHOTOCTL_VOLUME_MAP,
  libraryPath?: string,
): VolumeResolver {
  const external = mapping ? new EnvVolumeResolver(mapping) : new MacVolumeResolver();
  if (!libraryPath) return external;
  return new LibraryVolumeResolver(external, libraryPath);
}

export class LibraryVolumeResolver implements VolumeResolver {
  readonly #libraryMount: string;

  constructor(
    private readonly external: VolumeResolver,
    libraryPath: string,
  ) {
    this.#libraryMount = resolvePath(libraryPath);
  }

  async locate(path: string): Promise<VolumeLocation> {
    return await this.external.locate(path);
  }

  async resolve(volumeUuid: string, relPath: string): Promise<ResolvedLocator> {
    if (volumeUuid !== LIBRARY_VOLUME_UUID) {
      return await this.external.resolve(volumeUuid, relPath);
    }
    const path = joinWithin(this.#libraryMount, relPath);
    try {
      await access(path);
      return { mount: this.#libraryMount, path, online: true };
    } catch {
      return { mount: this.#libraryMount, path: null, online: false };
    }
  }
}

interface EnvVolume {
  mount: string;
  uuid: string;
  online: boolean;
}

export interface MacVolumeInfo {
  uuid: string;
  label: string | null;
  mount: string;
}

export type DiskutilRunner = (target: string) => Promise<string | null>;

export class EnvVolumeResolver implements VolumeResolver {
  readonly #volume: EnvVolume;

  constructor(mapping = process.env.PHOTOCTL_VOLUME_MAP) {
    if (!mapping) {
      throw new PhotoctlError("usage", "PHOTOCTL_VOLUME_MAP is required");
    }
    this.#volume = parseVolumeMap(mapping);
  }

  async locate(path: string): Promise<VolumeLocation> {
    let absolutePath: string;
    try {
      absolutePath = await realpath(path);
    } catch (error) {
      if (this.#volume.online) throw error;
      const lexicalPath = resolvePath(path);
      if (relativeWithin(this.#volume.mount, lexicalPath) === null) {
        throw new PhotoctlError("file_offline", `Path is outside the configured volume: ${path}`);
      }
      throw new PhotoctlError("file_offline", `Source volume is offline: ${path}`);
    }
    const mount = await canonicalMount(this.#volume);
    const relPath = relativeWithin(mount, absolutePath);
    if (relPath === null) {
      throw new PhotoctlError("file_offline", `Path is outside the configured volume: ${path}`);
    }
    return {
      uuid: this.#volume.uuid,
      label: basename(mount) || null,
      mount,
      relPath,
      online: this.#volume.online,
    };
  }

  async resolve(volumeUuid: string, relPath: string): Promise<ResolvedLocator> {
    if (volumeUuid !== this.#volume.uuid || !this.#volume.online) {
      return { mount: null, path: null, online: false };
    }
    const mount = await canonicalMount(this.#volume);
    const path = joinWithin(mount, relPath);
    try {
      await access(path);
      return { mount, path, online: true };
    } catch {
      return { mount, path: null, online: false };
    }
  }
}

export class MacVolumeResolver implements VolumeResolver {
  constructor(private readonly runDiskutil: DiskutilRunner = runDiskutilInfo) {}

  async locate(path: string): Promise<VolumeLocation> {
    const absolutePath = await realpath(path);
    const info = await this.findVolume(absolutePath);
    const relPath = relativeWithin(info.mount, absolutePath);
    if (relPath === null) {
      throw new PhotoctlError("file_offline", `Cannot locate the volume for: ${path}`);
    }
    return { ...info, relPath, online: true };
  }

  async resolve(volumeUuid: string, relPath: string): Promise<ResolvedLocator> {
    const info = await this.readInfo(volumeUuid);
    if (!info) return { mount: null, path: null, online: false };
    const path = joinWithin(info.mount, relPath);
    try {
      await access(path);
      return { mount: info.mount, path, online: true };
    } catch {
      return { mount: info.mount, path: null, online: false };
    }
  }

  private async findVolume(candidate: string): Promise<MacVolumeInfo> {
    const info = await this.readInfo(candidate);
    if (info) return info;
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new PhotoctlError("file_offline", `Cannot locate a mounted volume for: ${candidate}`);
    }
    return await this.findVolume(parent);
  }

  private async readInfo(target: string): Promise<MacVolumeInfo | null> {
    const plist = await this.runDiskutil(target);
    if (!plist) return null;
    const uuid = plistString(plist, "VolumeUUID");
    const mount = plistString(plist, "MountPoint");
    if (!uuid || !mount) return null;
    return { uuid, label: plistString(plist, "VolumeName"), mount };
  }
}

export async function resolvePhotoId(db: Pick<PGlite, "query">, input: string): Promise<string> {
  if (!/^[0-9a-f-]{1,36}$/i.test(input)) {
    throw new PhotoctlError("usage", `Invalid photo ID or prefix: ${input}`);
  }
  const matches = await db.query<{ id: string }>(
    "SELECT id::text AS id FROM photos WHERE id::text LIKE $1 ORDER BY id LIMIT 2",
    [`${input.toLowerCase()}%`],
  );
  const id = matches.rows[0]?.id;
  if (!id) {
    throw new PhotoctlError("not_found", `Photo not found: ${input}`, { id: input });
  }
  if (matches.rows.length > 1) {
    throw new PhotoctlError("not_found", `Photo ID prefix is ambiguous: ${input}`, {
      id: input,
      reason: "ambiguous",
    });
  }
  return id;
}

function parseVolumeMap(mapping: string): EnvVolume {
  const equals = mapping.indexOf("=");
  const colon = mapping.lastIndexOf(":");
  if (equals <= 0 || colon <= equals + 1) invalidVolumeMap();
  const mount = resolvePath(mapping.slice(0, equals));
  const uuid = mapping.slice(equals + 1, colon);
  const status = mapping.slice(colon + 1);
  if (!isAbsolute(mapping.slice(0, equals)) || !uuid || !["online", "offline"].includes(status)) {
    invalidVolumeMap();
  }
  return { mount, uuid, online: status === "online" };
}

function invalidVolumeMap(): never {
  throw new PhotoctlError(
    "usage",
    "PHOTOCTL_VOLUME_MAP must be /absolute/mount=UUID:online|offline",
  );
}

async function canonicalMount(volume: EnvVolume): Promise<string> {
  try {
    return await realpath(volume.mount);
  } catch (error) {
    if (!volume.online) return volume.mount;
    throw error;
  }
}

function relativeWithin(mount: string, path: string): string | null {
  const relPath = relative(mount, path);
  if (relPath === ".." || relPath.startsWith(`..${sep}`) || isAbsolute(relPath)) {
    return null;
  }
  return relPath;
}

function joinWithin(mount: string, relPath: string): string {
  if (!relPath || isAbsolute(relPath)) {
    throw new PhotoctlError("usage", `Invalid volume-relative path: ${relPath}`);
  }
  const path = join(mount, relPath);
  if (relativeWithin(mount, path) === null) {
    throw new PhotoctlError("usage", `Invalid volume-relative path: ${relPath}`);
  }
  return path;
}

const execFileAsync = promisify(execFile);

async function runDiskutilInfo(target: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/sbin/diskutil", ["info", "-plist", target], {
      encoding: "utf8",
    });
    return stdout;
  } catch {
    return null;
  }
}

function plistString(plist: string, key: string): string | null {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist);
  if (!match) return null;
  return match[1]
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}
