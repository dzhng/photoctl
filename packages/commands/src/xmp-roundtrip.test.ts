import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeLibrary } from "@photoctl/library";
import type { CommandRequest } from "@photoctl/protocol";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import { xmpCommand } from "./handlers/xmp.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("explicit XMP write round-trips catalog cull metadata without touching image bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-roundtrip-"));
  const drive = join(root, "drive");
  const image = join(drive, "frame.png");
  const sidecar = join(drive, "frame.xmp");
  await mkdir(drive);
  await writeFile(image, png);
  await writeFile(sidecar, sidecarWithForeignNode);
  const imageHash = sha256(await readFile(image));
  const first = await initializeLibrary(join(root, "first-library"));
  const env = {
    noDaemon: true,
    cacheRoot: join(root, "cache"),
    volumeMap: `${drive}=xmp-volume:online`,
  };
  try {
    const imported = await dispatch(request("import", [image, "--link"], env), {
      version: "test",
      library: first.handle,
    });
    const id = (imported as { data: { ids: string[] } }).data.ids[0];
    for (const [verb, args] of [
      ["rate", [id, "--stars", "5"]],
      ["flag", [id, "--pick"]],
      ["label", [id, "green"]],
      ["tag", [id, "--add", "Anna & Ben"]],
    ] as const) {
      expect(
        (await dispatch(request(verb, [...args], env), { version: "test", library: first.handle }))
          .ok,
      ).toBe(true);
    }

    const written = await dispatch(request("xmp", ["write", id], env), {
      version: "test",
      library: first.handle,
    });

    expect(written).toMatchObject({
      ok: true,
      summary: { ok: 1, failed: 0 },
      results: [{ id, ok: true, action: "written", sidecar: await realpath(sidecar) }],
    });
    expect(await readFile(image).then(sha256)).toBe(imageHash);
    expect(await readFile(sidecar, "utf8")).toContain(foreignNode);
    await first.handle.close();

    const second = await initializeLibrary(join(root, "second-library"));
    try {
      const reimported = await dispatch(request("import", [image, "--link"], env), {
        version: "test",
        library: second.handle,
      });
      const freshId = (reimported as { data: { ids: string[] } }).data.ids[0];
      const state = await second.handle.query<{
        rating: number;
        flag: string;
        label: string | null;
        tags: string[];
      }>(
        `SELECT p.rating, p.flag, p.label,
                array(SELECT tag FROM tags WHERE photo_id = p.id ORDER BY tag) AS tags
         FROM photos p WHERE p.id = $1`,
        [freshId],
      );
      expect(state.rows).toEqual([
        { rating: 5, flag: "pick", label: "green", tags: ["Anna & Ben"] },
      ]);
    } finally {
      await second.handle.close();
    }
  } finally {
    await first.handle.close().catch(() => undefined);
    await rm(root, { recursive: true });
  }
}, 30_000);

test("sync --read replaces sidecar-owned fields, preserves an absent flag, and clears stale diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-sync-"));
  const drive = join(root, "drive");
  const image = join(drive, "frame.png");
  const sidecar = join(drive, "frame.xmp");
  await mkdir(drive);
  await writeFile(image, png);
  const library = await initializeLibrary(join(root, "library"));
  const env = {
    noDaemon: true,
    cacheRoot: join(root, "cache"),
    volumeMap: `${drive}=xmp-volume:online`,
  };
  try {
    const imported = await dispatch(request("import", [image, "--link"], env), {
      version: "test",
      library: library.handle,
    });
    const id = (imported as { data: { ids: string[] } }).data.ids[0];
    await dispatch(request("flag", [id, "--pick"], env), {
      version: "test",
      library: library.handle,
    });
    await dispatch(request("xmp", ["write", id], env), {
      version: "test",
      library: library.handle,
    });

    await writeFile(sidecar, externalXmp({ rating: 3, label: "Blue", tags: ["external"] }));
    const changed = new Date("2030-01-02T03:04:05Z");
    await utimes(sidecar, changed, changed);
    expect(
      await dispatch(request("list", ["--xmp-stale"], env), {
        version: "test",
        library: library.handle,
      }),
    ).toMatchObject({ ok: true, data: { rows: [{ id }], total: 1 } });
    expect(
      await dispatch(request("doctor", [], env), { version: "test", library: library.handle }),
    ).toMatchObject({
      ok: true,
      data: { xmp: { stale: 1 } },
      warnings: [{ code: "xmp_stale" }],
    });

    const synced = await dispatch(request("xmp", ["sync", id, "--read"], env), {
      version: "test",
      library: library.handle,
    });
    expect(synced).toMatchObject({
      ok: true,
      results: [{ id, ok: true, action: "read", sidecar: await realpath(sidecar) }],
    });
    expect(await cullState(library.handle, id)).toEqual({
      rating: 3,
      flag: "pick",
      label: "blue",
      tags: ["external"],
    });
    expect(
      await dispatch(request("doctor", [], env), { version: "test", library: library.handle }),
    ).toMatchObject({ ok: true, data: { xmp: { stale: 0 } }, warnings: [] });

    await writeFile(sidecar, externalXmp({ rating: 2, label: null, tags: [], flag: "reject" }));
    await dispatch(request("xmp", ["sync", "--read", id], env), {
      version: "test",
      library: library.handle,
    });
    expect(await cullState(library.handle, id)).toEqual({
      rating: 2,
      flag: "reject",
      label: null,
      tags: [],
    });
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("a read-only whole-file sidecar failure does not starve an embedded-container write", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-batch-"));
  const drive = join(root, "drive");
  const readonly = join(drive, "readonly");
  const image = join(readonly, "frame.png");
  const raw = join(drive, "frame.ARW");
  await mkdir(readonly, { recursive: true });
  await writeFile(image, png);
  await copyFile(join(process.cwd(), "fixtures/a7c2.ARW"), raw);
  const before = { image: sha256(await readFile(image)), raw: sha256(await readFile(raw)) };
  const library = await initializeLibrary(join(root, "library"));
  const env = {
    noDaemon: true,
    cacheRoot: join(root, "cache"),
    volumeMap: `${drive}=xmp-volume:online`,
  };
  try {
    const imported = await dispatch(request("import", [drive, "--link", "--recursive"], env), {
      version: "test",
      library: library.handle,
    });
    expect(imported).toMatchObject({ ok: true, data: { imported: 2 } });
    const files = await library.handle.query<{ id: string; rel_path: string }>(
      `SELECT p.id::text AS id, f.rel_path
       FROM photos p JOIN files f ON f.photo_id = p.id ORDER BY f.rel_path`,
    );
    const pngId = files.rows.find((row) => row.rel_path.endsWith("frame.png"))?.id;
    const rawId = files.rows.find((row) => row.rel_path.endsWith("frame.ARW"))?.id;
    if (!pngId || !rawId) throw new Error("Expected both fixture photos");
    await chmod(readonly, 0o555);

    const written = await dispatch(request("xmp", ["write", pngId, rawId], env), {
      version: "test",
      library: library.handle,
    });

    expect(written).toMatchObject({
      ok: false,
      code: "partial",
      summary: { ok: 1, failed: 1 },
      results: [
        { id: pngId, ok: false, code: "volume_readonly" },
        { id: rawId, ok: true, action: "written" },
      ],
    });
    expect(await readFile(image).then(sha256)).toBe(before.image);
    expect(await readFile(raw).then(sha256)).toBe(before.raw);
    expect(await readFile(join(drive, "frame.xmp"), "utf8")).toContain(`xmp:Rating="0"`);
  } finally {
    await chmod(readonly, 0o755).catch(() => undefined);
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("an item-local filesystem shape error does not abort later writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-isolation-"));
  const drive = join(root, "drive");
  const firstImage = join(drive, "first.png");
  const secondImage = join(drive, "second.ARW");
  await mkdir(drive);
  await writeFile(firstImage, png);
  await copyFile(join(process.cwd(), "fixtures/a7c2.ARW"), secondImage);
  const library = await initializeLibrary(join(root, "library"));
  const env = {
    noDaemon: true,
    cacheRoot: join(root, "cache"),
    volumeMap: `${drive}=xmp-volume:online`,
  };
  try {
    const imported = await dispatch(request("import", [drive, "--link", "--recursive"], env), {
      version: "test",
      library: library.handle,
    });
    const ids = (imported as { data: { ids: string[] } }).data.ids;
    const files = await library.handle.query<{ id: string; rel_path: string }>(
      `SELECT p.id::text AS id, f.rel_path FROM photos p JOIN files f ON f.photo_id = p.id`,
    );
    const firstId = files.rows.find((row) => row.rel_path.endsWith("first.png"))?.id;
    const secondId = files.rows.find((row) => row.rel_path.endsWith("second.ARW"))?.id;
    expect(ids).toHaveLength(2);
    if (!firstId || !secondId) throw new Error("Expected both imported photos");
    await mkdir(join(drive, "first.xmp"));

    const result = await dispatch(request("xmp", ["write", firstId, secondId], env), {
      version: "test",
      library: library.handle,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "partial",
      summary: { ok: 1, failed: 1 },
      results: [
        { id: firstId, ok: false, code: "unsupported_file" },
        { id: secondId, ok: true, action: "written" },
      ],
    });
    expect(await readFile(join(drive, "second.xmp"), "utf8")).toContain(`xmp:Rating="0"`);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("a post-verification sidecar conflict fails one item without starving the batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-publish-conflict-"));
  const drive = join(root, "drive");
  const firstImage = join(drive, "first.png");
  const firstSidecar = join(drive, "first.xmp");
  const secondImage = join(drive, "second.ARW");
  const secondSidecar = join(drive, "second.xmp");
  await mkdir(drive);
  await writeFile(firstImage, png);
  await writeFile(firstSidecar, externalVersion("initial"));
  await copyFile(join(process.cwd(), "fixtures/a7c2.ARW"), secondImage);
  const library = await initializeLibrary(join(root, "library"));
  const env = {
    noDaemon: true,
    cacheRoot: join(root, "cache"),
    volumeMap: `${drive}=xmp-volume:online`,
  };
  try {
    await dispatch(request("import", [drive, "--link", "--recursive"], env), {
      version: "test",
      library: library.handle,
    });
    const files = await library.handle.query<{ id: string; rel_path: string }>(
      `SELECT p.id::text AS id, f.rel_path FROM photos p JOIN files f ON f.photo_id = p.id`,
    );
    const firstId = files.rows.find((row) => row.rel_path.endsWith("first.png"))?.id;
    const secondId = files.rows.find((row) => row.rel_path.endsWith("second.ARW"))?.id;
    if (!firstId || !secondId) throw new Error("Expected both imported photos");
    let lastExternal = "";

    const result = await xmpCommand(
      ["write", firstId, secondId],
      env,
      process.cwd(),
      library.handle,
      {
        writeHooks: (id) =>
          id === firstId
            ? {
                afterSnapshotCompare: async (attempt) => {
                  const replacement = join(drive, `replacement-${attempt}.xmp`);
                  lastExternal = externalVersion(`external-${attempt}`);
                  await writeFile(replacement, lastExternal);
                  await rename(replacement, firstSidecar);
                },
              }
            : undefined,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      code: "partial",
      summary: { ok: 1, failed: 1 },
      results: [
        { id: firstId, ok: false, code: "unsupported_file" },
        { id: secondId, ok: true, action: "written" },
      ],
    });
    expect(await readFile(firstSidecar, "utf8")).toBe(lastExternal);
    expect(await readFile(secondSidecar, "utf8")).toContain(`xmp:Rating="0"`);
    expect((await readdir(drive)).filter((name) => name.includes(".photoctl-"))).toEqual([]);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

const foreignNode = `<crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012>`;
const sidecarWithForeignNode = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmp:Rating="1">${foreignNode}</rdf:Description></rdf:RDF>`;

function request(verb: string, args: string[], env: CommandRequest["env"]): CommandRequest {
  return { verb, args, cwd: process.cwd(), env };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function externalXmp(metadata: {
  rating: number;
  label: string | null;
  tags: string[];
  flag?: "pick" | "reject" | "none";
}): string {
  const label = metadata.label === null ? "" : ` xmp:Label="${metadata.label}"`;
  const flag = metadata.flag === undefined ? "" : ` photoctl:flag="${metadata.flag}"`;
  const tags = metadata.tags.map((tag) => `<rdf:li>${tag}</rdf:li>`).join("");
  return `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoctl="http://photoctl.dev/xmp/1.0/" xmp:Rating="${metadata.rating}"${label}${flag}><dc:subject><rdf:Bag>${tags}</rdf:Bag></dc:subject></rdf:Description></rdf:RDF>`;
}

function externalVersion(version: string): string {
  return `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description><keep:version>${version}</keep:version></rdf:Description></rdf:RDF>`;
}

async function cullState(
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"],
  id: string,
) {
  const state = await handle.query<{
    rating: number;
    flag: string;
    label: string | null;
    tags: string[];
  }>(
    `SELECT p.rating, p.flag, p.label,
            array(SELECT tag FROM tags WHERE photo_id = p.id ORDER BY tag) AS tags
     FROM photos p WHERE p.id = $1`,
    [id],
  );
  return state.rows[0];
}
