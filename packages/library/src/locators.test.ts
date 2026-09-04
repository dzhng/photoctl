import { PGlite } from "@electric-sql/pglite";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { EnvVolumeResolver, MacVolumeResolver, resolvePhotoId } from "./locators.js";
import { migrate } from "./migrations/runner.js";

test("the environment resolver stores a mount-relative locator", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-volume-"));
  const mount = join(directory, "A7C2");
  const source = join(mount, "DCIM", "100MSDCF", "a7c2.ARW");
  try {
    await mkdir(join(mount, "DCIM", "100MSDCF"), { recursive: true });
    await writeFile(source, "raw");
    const resolver = new EnvVolumeResolver(`${mount}=6A1F-0C3B:online`);

    const located = await resolver.locate(source);

    expect(located).toEqual({
      uuid: "6A1F-0C3B",
      label: "A7C2",
      mount: await realpath(mount),
      relPath: "DCIM/100MSDCF/a7c2.ARW",
      online: true,
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("an offline map keeps an existing host directory offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-volume-offline-"));
  const mount = join(directory, "A7C2");
  const source = join(mount, "a7c2.ARW");
  try {
    await mkdir(mount);
    await writeFile(source, "raw");
    const resolver = new EnvVolumeResolver(`${mount}=6A1F-0C3B:offline`);

    const located = await resolver.locate(source);
    const resolved = await resolver.resolve("6A1F-0C3B", "a7c2.ARW");

    expect(located.online).toBe(false);
    expect(resolved).toEqual({ mount: null, path: null, online: false });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("the mac resolver follows a volume UUID across its mounted path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-volume-mac-"));
  const mount = await realpath(directory);
  const source = join(mount, "DCIM", "a7c2.ARW");
  const info = { uuid: "01234567-89AB-CDEF-0123-456789ABCDEF", label: "A7C2", mount };
  try {
    await mkdir(join(mount, "DCIM"));
    await writeFile(source, "raw");
    const resolver = new MacVolumeResolver(async (target) => {
      return target === mount || target === info.uuid
        ? `<?xml version="1.0"?><plist><dict>
             <key>VolumeUUID</key><string>${info.uuid}</string>
             <key>VolumeName</key><string>A7C2</string>
             <key>MountPoint</key><string>${mount}</string>
           </dict></plist>`
        : null;
    });

    const located = await resolver.locate(source);
    const resolved = await resolver.resolve(info.uuid, "DCIM/a7c2.ARW");

    expect(located).toEqual({
      uuid: info.uuid,
      label: "A7C2",
      mount,
      relPath: "DCIM/a7c2.ARW",
      online: true,
    });
    expect(resolved).toEqual({ mount, path: source, online: true });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a unique photo ID prefix resolves to the full ID", async () => {
  const db = await PGlite.create();
  try {
    await migrate(db);
    await insertPhoto(db, "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001", "ck_0000000000000001");
    await insertPhoto(db, "0299a7c2-3b1e-7c40-8f2a-1d0e5a91c002", "ck_0000000000000002");

    const id = await resolvePhotoId(db, "0199A7C2-3B1E");

    expect(id).toBe("0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001");
  } finally {
    await db.close();
  }
});

test("an ambiguous photo ID prefix is never resolved arbitrarily", async () => {
  const db = await PGlite.create();
  try {
    await migrate(db);
    await insertPhoto(db, "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001", "ck_0000000000000001");
    await insertPhoto(db, "0199a7c2-4c2f-7c40-8f2a-1d0e5a91c002", "ck_0000000000000002");

    await expect(resolvePhotoId(db, "0199a7c2")).rejects.toMatchObject({
      code: "not_found",
      data: { id: "0199a7c2", reason: "ambiguous" },
    });
  } finally {
    await db.close();
  }
});

test("a photo prefix cannot inject SQL wildcard matching", async () => {
  const db = await PGlite.create();
  try {
    await migrate(db);
    await insertPhoto(db, "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001", "ck_0000000000000001");

    await expect(resolvePhotoId(db, "%")).rejects.toMatchObject({ code: "usage" });
  } finally {
    await db.close();
  }
});

async function insertPhoto(db: PGlite, id: string, contentKey: string): Promise<void> {
  await db.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, $2, 1, 1, 1, 1)`,
    [id, contentKey],
  );
}
