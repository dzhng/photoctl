import { fullFileHash, identifyFile, initializeLibrary } from "@photoctl/library";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  rename,
  writeFile,
  stat,
  readFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { dispatch } from "./dispatch.js";

test("paired import is one logical photo with independently identified RAW and JPEG originals", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-paired-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  try {
    await mkdir(drive);
    const raw = join(drive, "frame.ARW");
    const jpeg = join(drive, "FRAME.JPG");
    await copyFile(resolve("fixtures/camera/DSC08819.ARW"), raw);
    await copyFile(resolve("fixtures/camera/DSC08819.JPG"), jpeg);
    const request = {
      verb: "import",
      args: [drive, "--link"],
      cwd: root,
      env: {
        noDaemon: true,
        cacheRoot: join(root, "cache"),
        volumeMap: `${drive}=paired-drive:online`,
      },
    };
    const first = await dispatch(request, { version: "test", library: library.handle });
    expect(first).toMatchObject({ ok: true, data: { imported: 1, already_present: 0 } });
    const id = (first as { data: { ids: string[] } }).data.ids[0];
    const originals = await library.handle.query<{
      id: string;
      kind: string;
      content_key: string;
      rel_path: string;
      primary: boolean;
    }>(
      `SELECT o.id::text, o.kind, o.content_key, f.rel_path, p.primary_original_id = o.id AS primary
        FROM originals o JOIN photos p ON p.id = o.photo_id
        JOIN files f ON f.original_id = o.id WHERE p.id = $1 ORDER BY o.kind`,
      [id],
    );
    expect(originals.rows).toEqual([
      {
        id: expect.any(String),
        kind: "jpeg",
        content_key: (await identifyFile(jpeg)).contentKey,
        rel_path: "FRAME.JPG",
        primary: false,
      },
      {
        id: expect.any(String),
        kind: "raw",
        content_key: (await identifyFile(raw)).contentKey,
        rel_path: "frame.ARW",
        primary: true,
      },
    ]);
    const second = await dispatch(request, { version: "test", library: library.handle });
    expect(second).toMatchObject({
      ok: true,
      data: { imported: 0, already_present: 1, ids: [id] },
    });
    const listed = await dispatch(
      { ...request, verb: "list", args: [] },
      { version: "test", library: library.handle },
    );
    expect(listed).toMatchObject({
      ok: true,
      data: {
        total: 1,
        rows: [
          {
            id,
            file: "frame.ARW",
            primary_original_id: originals.rows[1].id,
            originals: [
              { id: originals.rows[1].id, kind: "raw", online: true },
              { id: originals.rows[0].id, kind: "jpeg", online: true },
            ],
          },
        ],
      },
    });
    const searched = await dispatch(
      { ...request, verb: "search", args: ["frame"] },
      { version: "test", library: library.handle },
    );
    expect(searched).toMatchObject({ ok: true, data: { hits: [{ id, file: "frame.ARW" }] } });
    const camera = await dispatch(
      { ...request, verb: "show", args: [id, "--source", "camera-jpeg"] },
      { version: "test", library: library.handle },
    );
    expect(camera).toMatchObject({ ok: true, data: { id, develop: {}, crop: null } });
    const cameraExport = await dispatch(
      {
        ...request,
        verb: "export",
        args: [id, "--source", "camera-jpeg", "--to", join(root, "delivery"), "--resize", "320"],
      },
      { version: "test", library: library.handle },
    );
    expect(cameraExport).toMatchObject({
      ok: true,
      results: [
        {
          id,
          ok: true,
          render_hash: (camera as { data: { render_hash: string } }).data.render_hash,
        },
      ],
    });
    expect((await library.handle.query("SELECT photo_id FROM photo_documents")).rows).toEqual([]);
    const shown = await dispatch(
      { ...request, verb: "show", args: [id] },
      { version: "test", library: library.handle },
    );
    expect(shown).toMatchObject({
      ok: true,
      data: {
        id,
        primary_original_id: originals.rows[1].id,
        originals: [
          { id: originals.rows[1].id, kind: "raw", locators: [{ path: "frame.ARW" }] },
          { id: originals.rows[0].id, kind: "jpeg", locators: [{ path: "FRAME.JPG" }] },
        ],
      },
    });
    expect((camera as { data: { render_hash: string } }).data.render_hash).not.toBe(
      (shown as { data: { render_hash: string } }).data.render_hash,
    );
    const split = await dispatch(
      { ...request, args: [...request.args, "--companions", "both"] },
      { version: "test", library: library.handle },
    );
    expect(split).toMatchObject({
      ok: false,
      code: "partial",
      data: { imported: 0, skipped_conflicts: 2 },
    });
    const retained = await library.handle.query(
      "SELECT id::text, photo_id::text FROM originals ORDER BY kind",
    );
    expect(retained.rows).toEqual(
      originals.rows.map((original) => ({ id: original.id, photo_id: id })),
    );
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test.each([
  ["ARW", "JPG", "jpeg", "raw"],
  ["JPG", "ARW", "raw", "jpeg"],
] as const)(
  "a valid %s survives a corrupt %s regardless of companion-only policy",
  async (validExtension, corruptExtension, policy, kind) => {
    const root = await mkdtemp(join(tmpdir(), "photoctl-pair-survivor-"));
    const drive = join(root, "drive");
    const library = await initializeLibrary(join(root, "library"));
    try {
      await mkdir(drive);
      const valid = join(drive, `frame.${validExtension}`);
      await copyFile(resolve(`fixtures/camera/DSC08819.${validExtension}`), valid);
      await writeFile(join(drive, `frame.${corruptExtension}`), "not a decodable image");
      const result = await dispatch(
        {
          verb: "import",
          args: [drive, "--link", "--companions", policy],
          cwd: root,
          env: {
            noDaemon: true,
            cacheRoot: join(root, "cache"),
            volumeMap: `${drive}=drive:online`,
          },
        },
        { version: "test", library: library.handle },
      );
      expect(result).toMatchObject({
        ok: true,
        data: { imported: 1, skipped_unsupported: 1, skipped_conflicts: 0 },
      });
      expect((await library.handle.query("SELECT kind, content_key FROM originals")).rows).toEqual([
        { kind, content_key: (await identifyFile(valid)).contentKey },
      ]);
      expect((await library.handle.query("SELECT rel_path FROM files")).rows).toEqual([
        { rel_path: `frame.${validExtension}` },
      ]);
    } finally {
      await library.handle.close();
      await rm(root, { recursive: true });
    }
  },
  30_000,
);

test("camera JPEG keeps its own full dimensions and cache across RAW edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-paired-dimensions-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  try {
    await mkdir(drive);
    for (const extension of ["ARW", "JPG"])
      await copyFile(
        resolve(`fixtures/camera/DSC00103.${extension}`),
        join(drive, `frame.${extension}`),
      );
    const request = {
      verb: "import",
      args: [drive, "--link"],
      cwd: root,
      env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
    };
    const imported = await dispatch(request, { version: "test", library: library.handle });
    expect(imported).toMatchObject({ ok: true, data: { imported: 1 } });
    const id = (imported as { data: { ids: string[] } }).data.ids[0];
    const cameraArgs = [id, "--source", "camera-jpeg", "--preview-size", "320"];
    const before = await dispatch(
      { ...request, verb: "show", args: cameraArgs },
      { version: "test", library: library.handle },
    );
    expect(before).toMatchObject({
      ok: true,
      data: {
        dims: { w: 7008, h: 4672 },
        originals: [
          { kind: "raw", dims: { w: 3504, h: 2336 } },
          { kind: "jpeg", dims: { w: 7008, h: 4672 } },
        ],
        preview_info: { source_dimensions: { w: 7008, h: 4672 } },
      },
    });
    expect(
      await dispatch(
        { ...request, verb: "develop", args: [id, "--set", "exposure=1"] },
        { version: "test", library: library.handle },
      ),
    ).toMatchObject({ ok: true });
    const active = (await library.handle.query("SELECT * FROM photo_documents")).rows;
    const after = await dispatch(
      { ...request, verb: "show", args: cameraArgs },
      { version: "test", library: library.handle },
    );
    const camera = (
      before as { data: { render_hash: string; source_original_id: string; preview: string } }
    ).data;
    expect(after).toMatchObject({
      ok: true,
      data: {
        render_hash: camera.render_hash,
        preview: camera.preview,
        source_original_id: camera.source_original_id,
        develop: {},
        crop: null,
      },
    });
    const exported = await dispatch(
      {
        ...request,
        verb: "export",
        args: [id, "--source", "camera-jpeg", "--to", join(root, "delivery")],
      },
      { version: "test", library: library.handle },
    );
    expect(exported).toMatchObject({
      ok: true,
      results: [
        {
          id,
          w: 7008,
          h: 4672,
          source_original_id: camera.source_original_id,
          render_hash: camera.render_hash,
        },
      ],
    });
    expect((await library.handle.query("SELECT * FROM photo_documents")).rows).toEqual(active);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test.each(["raw", "jpeg", "both"] as const)(
  "late pairing preserves existing %s edit ownership",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "photoctl-late-pair-"));
    const drive = join(root, "drive");
    const library = await initializeLibrary(join(root, "library"));
    try {
      await mkdir(drive);
      for (const extension of ["ARW", "JPG"])
        await copyFile(
          resolve(`fixtures/camera/DSC08819.${extension}`),
          join(drive, `frame.${extension}`),
        );
      const request = {
        verb: "import",
        args: [drive, "--link", "--companions", mode],
        cwd: root,
        env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
      };
      const first = await dispatch(request, { version: "test", library: library.handle });
      const ids = (first as { data: { ids: string[] } }).data.ids;
      expect(
        await dispatch(
          { ...request, verb: "develop", args: [...ids, "--set", "exposure=0.3"] },
          { version: "test", library: library.handle },
        ),
      ).toMatchObject({ ok: true });
      const documents = (
        await library.handle.query("SELECT * FROM photo_documents ORDER BY photo_id")
      ).rows;
      const originals = (
        await library.handle.query(
          "SELECT id::text, photo_id::text, kind FROM originals ORDER BY kind",
        )
      ).rows;
      const paired = await dispatch(
        { ...request, args: [drive, "--link"] },
        { version: "test", library: library.handle },
      );
      expect(
        (await library.handle.query("SELECT * FROM photo_documents ORDER BY photo_id")).rows,
      ).toEqual(documents);
      const retained = (
        await library.handle.query(
          "SELECT id::text, photo_id::text, kind FROM originals ORDER BY kind",
        )
      ).rows;
      if (mode === "raw") {
        expect(paired).toMatchObject({ ok: true, data: { imported: 0, already_present: 1, ids } });
        expect(retained).toEqual([
          { id: expect.any(String), photo_id: ids[0], kind: "jpeg" },
          originals[0],
        ]);
      } else {
        expect(paired).toMatchObject({
          ok: false,
          code: "partial",
          data: { imported: 0, skipped_conflicts: 1 },
        });
        expect(retained).toEqual(originals);
      }
    } finally {
      await library.handle.close();
      await rm(root, { recursive: true });
    }
  },
  30_000,
);

test("an existing pair cannot acquire a second distinct JPEG but accepts another locator", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-pair-extra-jpeg-"));
  const drive = join(root, "drive");
  const first = join(drive, "first");
  const second = join(drive, "second");
  const library = await initializeLibrary(join(root, "library"));
  try {
    await mkdir(first, { recursive: true });
    await mkdir(second);
    for (const folder of [first, second])
      for (const extension of ["ARW", "JPG"]) {
        await copyFile(
          resolve(`fixtures/camera/DSC08819.${extension}`),
          join(folder, `frame.${extension}`),
        );
      }
    const request = {
      verb: "import",
      args: [first, "--link"],
      cwd: root,
      env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
    };
    const imported = await dispatch(request, { version: "test", library: library.handle });
    const id = (imported as { data: { ids: string[] } }).data.ids[0];
    const duplicate = await dispatch(
      { ...request, args: [second, "--link"] },
      { version: "test", library: library.handle },
    );
    expect(duplicate).toMatchObject({
      ok: true,
      data: { imported: 0, already_present: 1, ids: [id] },
    });
    await rename(join(first, "frame.ARW"), join(first, "moved.ARW"));
    expect(
      await dispatch(
        { ...request, args: [join(first, "moved.ARW"), "--link"] },
        { version: "test", library: library.handle },
      ),
    ).toMatchObject({ ok: true, data: { imported: 0, already_present: 1, ids: [id] } });
    const before = (
      await library.handle.query(
        "SELECT id::text, photo_id::text, kind FROM originals ORDER BY kind",
      )
    ).rows;
    const locations = (
      await library.handle.query("SELECT original_id::text, rel_path FROM files ORDER BY rel_path")
    ).rows;
    expect(locations.map((row) => row.rel_path)).toEqual([
      "first/frame.JPG",
      "first/moved.ARW",
      "second/frame.ARW",
      "second/frame.JPG",
    ]);
    const third = join(drive, "third");
    await mkdir(third);
    await copyFile(resolve("fixtures/camera/DSC08819.ARW"), join(third, "frame.ARW"));
    // Different valid JPEG bytes with unchanged capture metadata; not a distinct photograph.
    await writeFile(
      join(third, "frame.JPG"),
      Buffer.concat([
        await readFile(resolve("fixtures/camera/DSC08819.JPG")),
        Buffer.from("alternate-original"),
      ]),
    );
    const extra = await dispatch(
      { ...request, args: [third, "--link"] },
      { version: "test", library: library.handle },
    );
    expect(extra).toMatchObject({
      ok: false,
      code: "partial",
      data: { imported: 0, skipped_conflicts: 1 },
    });
    expect(
      (
        await library.handle.query(
          "SELECT id::text, photo_id::text, kind FROM originals ORDER BY kind",
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await library.handle.query(
          "SELECT original_id::text, rel_path FROM files ORDER BY rel_path",
        )
      ).rows,
    ).toEqual(locations);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("an online camera JPEG does not make a missing RAW primary available", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-paired-offline-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  try {
    await mkdir(drive);
    for (const extension of ["ARW", "JPG"])
      await copyFile(
        resolve(`fixtures/camera/DSC08819.${extension}`),
        join(drive, `frame.${extension}`),
      );
    const request = {
      verb: "import",
      args: [drive, "--link"],
      cwd: root,
      env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
    };
    const imported = await dispatch(request, { version: "test", library: library.handle });
    const id = (imported as { data: { ids: string[] } }).data.ids[0];
    await rename(join(drive, "frame.ARW"), join(root, "disconnected.ARW"));
    const listed = await dispatch(
      { ...request, verb: "list", args: [] },
      { version: "test", library: library.handle },
    );
    expect(listed).toMatchObject({
      data: {
        total: 1,
        rows: [
          {
            id,
            file: "frame.ARW",
            online: false,
            originals: [
              { kind: "raw", online: false },
              { kind: "jpeg", online: true },
            ],
          },
        ],
      },
    });
    const rawExport = await dispatch(
      { ...request, verb: "export", args: [id, "--to", join(root, "raw-delivery")] },
      { version: "test", library: library.handle },
    );
    const originals = (
      await library.handle.query<{ id: string; kind: string }>(
        "SELECT id::text, kind FROM originals WHERE photo_id = $1 ORDER BY kind",
        [id],
      )
    ).rows;
    expect(rawExport).toMatchObject({
      ok: true,
      results: [{ id, ok: true, source_original_id: originals[1].id }],
      warnings: [expect.objectContaining({ code: "source_offline", id })],
    });
    const cameraExport = await dispatch(
      {
        ...request,
        verb: "export",
        args: [
          id,
          "--source",
          "camera-jpeg",
          "--to",
          join(root, "camera-delivery"),
          "--resize",
          "320",
        ],
      },
      { version: "test", library: library.handle },
    );
    expect(cameraExport).toMatchObject({
      ok: true,
      results: [{ id, ok: true, w: 320, source_original_id: originals[0].id }],
      warnings: [],
    });
    const cameraArgs = [id, "--source", "camera-jpeg", "--preview-size", "320"];
    expect(
      await dispatch(
        { ...request, verb: "show", args: cameraArgs },
        { version: "test", library: library.handle },
      ),
    ).toMatchObject({ ok: true });
    await rename(join(drive, "frame.JPG"), join(root, "disconnected.JPG"));
    expect(
      await dispatch(
        { ...request, verb: "show", args: cameraArgs },
        { version: "test", library: library.handle },
      ),
    ).toMatchObject({ ok: false, code: "file_offline" });
    expect(
      await dispatch(
        {
          ...request,
          verb: "export",
          args: [id, "--source", "camera-jpeg", "--to", join(root, "offline-camera")],
        },
        { version: "test", library: library.handle },
      ),
    ).toMatchObject({ ok: false, results: [{ id, ok: false, code: "file_offline" }] });
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("content preflight reports progress before catalog admission begins", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-import-progress-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    await mkdir(drive);
    await copyFile(resolve("fixtures/camera/DSC08819.JPG"), join(drive, "first.payload"));
    await copyFile(resolve("fixtures/camera/DSC07730.JPG"), join(drive, "second.JPG"));
    const preflight: Array<{ done: number; total?: number; photos: number }> = [];
    const result = await dispatch(
      {
        verb: "import",
        args: [drive, "--link"],
        cwd: root,
        env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
      },
      {
        version: "test",
        library: library.handle,
        emit: async (event) => {
          if (event.event !== "progress" || event.phase !== "inspect") return;
          const photos = await library.handle.query<{ count: number }>(
            "SELECT COUNT(*)::int AS count FROM photos",
          );
          preflight.push({ done: event.done, total: event.total, photos: photos.rows[0].count });
          if (event.done === 1) clock.mockReturnValue(10_000);
        },
      },
    );
    expect(result).toMatchObject({ ok: true, data: { imported: 2, elapsed_s: 10 } });
    expect(preflight).toEqual([
      { done: 0, total: 2, photos: 0 },
      { done: 1, total: 2, photos: 0 },
      { done: 2, total: 2, photos: 0 },
    ]);
  } finally {
    clock.mockRestore();
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("replacing bytes at an imported locator cannot reparent that locator", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-locator-replacement-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  try {
    await mkdir(drive);
    const image = join(drive, "frame.JPG");
    await copyFile(resolve("fixtures/camera/DSC08819.JPG"), image);
    const request = {
      verb: "import",
      args: [image, "--link"],
      cwd: root,
      env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
    };
    expect(await dispatch(request, { version: "test", library: library.handle })).toMatchObject({
      ok: true,
    });
    const before = await library.handle.query(
      "SELECT f.id::text, f.original_id::text, o.photo_id::text, o.content_key FROM files f JOIN originals o ON o.id = f.original_id",
    );
    await copyFile(resolve("fixtures/camera/DSC07730.JPG"), image);
    const replaced = await dispatch(request, { version: "test", library: library.handle });
    expect(replaced).toMatchObject({
      ok: false,
      code: "partial",
      data: { imported: 0, skipped_conflicts: 1 },
    });
    expect(
      (
        await library.handle.query(
          "SELECT f.id::text, f.original_id::text, o.photo_id::text, o.content_key FROM files f JOIN originals o ON o.id = f.original_id",
        )
      ).rows,
    ).toEqual(before.rows);
    expect((await library.handle.query("SELECT id::text FROM photos")).rows).toEqual([
      { id: before.rows[0].photo_id },
    ]);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("same-stem originals with contradictory capture metadata are not paired", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-pair-mismatch-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  try {
    await mkdir(drive);
    await copyFile(resolve("fixtures/camera/DSC08819.ARW"), join(drive, "frame.ARW"));
    await copyFile(resolve("fixtures/camera/DSC07730.JPG"), join(drive, "frame.JPG"));
    const result = await dispatch(
      {
        verb: "import",
        args: [drive, "--link"],
        cwd: root,
        env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
      },
      { version: "test", library: library.handle },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "partial",
      data: { imported: 0, skipped_conflicts: 1 },
    });
    expect((await library.handle.query("SELECT id FROM photos")).rows).toEqual([]);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("ambiguous case-folded stems do not starve an unrelated valid original", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-pair-ambiguous-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  try {
    await mkdir(drive);
    await copyFile(resolve("fixtures/camera/DSC08819.ARW"), join(drive, "FRAME.ARW"));
    await copyFile(resolve("fixtures/camera/DSC08819.JPG"), join(drive, "frame.JPG"));
    await copyFile(resolve("fixtures/camera/DSC07730.JPG"), join(drive, "Frame.jpeg"));
    await copyFile(resolve("fixtures/camera/DSC09903.JPG"), join(drive, "unrelated.payload"));
    const result = await dispatch(
      {
        verb: "import",
        args: [drive, "--link"],
        cwd: root,
        env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
      },
      { version: "test", library: library.handle },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "partial",
      data: { imported: 1, skipped_unsupported: 0, skipped_conflicts: 1 },
    });
    expect((await library.handle.query("SELECT rel_path FROM files")).rows).toEqual([
      { rel_path: "unrelated.payload" },
    ]);
    const separate = await dispatch(
      {
        verb: "import",
        args: [drive, "--link", "--companions", "both"],
        cwd: root,
        env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
      },
      { version: "test", library: library.handle },
    );
    expect(separate).toMatchObject({
      ok: true,
      data: { imported: 3, already_present: 1, skipped_conflicts: 0 },
    });
    expect(
      (await library.handle.query("SELECT rel_path FROM files ORDER BY rel_path")).rows,
    ).toEqual([
      { rel_path: "FRAME.ARW" },
      { rel_path: "Frame.jpeg" },
      { rel_path: "frame.JPG" },
      { rel_path: "unrelated.payload" },
    ]);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test.each(["raw", "jpeg"] as const)(
  "explicit %s ignores ambiguity only in the excluded kind",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "photoctl-pair-selected-"));
    const drive = join(root, "drive");
    const library = await initializeLibrary(join(root, "library"));
    try {
      await mkdir(drive);
      const selectedExtension = mode === "raw" ? "ARW" : "JPG";
      const excludedExtension = mode === "raw" ? "JPG" : "ARW";
      const selected = join(drive, `frame.${selectedExtension}`);
      await copyFile(resolve(`fixtures/camera/DSC08819.${selectedExtension}`), selected);
      await copyFile(
        resolve(`fixtures/camera/DSC08819.${excludedExtension}`),
        join(drive, `FRAME.${excludedExtension}`),
      );
      await copyFile(
        resolve(`fixtures/camera/DSC07730.${excludedExtension}`),
        join(drive, "Frame.payload"),
      );
      const request = {
        verb: "import",
        args: [drive, "--link", "--companions", mode],
        cwd: root,
        env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
      };
      const imported = await dispatch(request, { version: "test", library: library.handle });
      expect(imported).toMatchObject({ ok: true, data: { imported: 1, skipped_conflicts: 0 } });
      const stored = (await library.handle.query("SELECT kind, content_key FROM originals")).rows;
      expect(stored).toEqual([
        { kind: mode, content_key: (await identifyFile(selected)).contentKey },
      ]);
      expect((await library.handle.query("SELECT rel_path FROM files")).rows).toEqual([
        { rel_path: `frame.${selectedExtension}` },
      ]);
      const ambiguous = await dispatch(
        { ...request, args: [drive, "--link", "--companions", mode === "raw" ? "jpeg" : "raw"] },
        { version: "test", library: library.handle },
      );
      expect(ambiguous).toMatchObject({
        ok: false,
        code: "partial",
        data: { imported: 0, skipped_conflicts: 1 },
      });
      expect((await library.handle.query("SELECT kind, content_key FROM originals")).rows).toEqual(
        stored,
      );
    } finally {
      await library.handle.close();
      await rm(root, { recursive: true });
    }
  },
  30_000,
);

test.each([
  ["raw", ["raw"], 1],
  ["jpeg", ["jpeg"], 1],
  ["both", ["jpeg", "raw"], 2],
] as const)(
  "explicit %s companion policy retains only selected paired originals",
  async (mode, kinds, count) => {
    const root = await mkdtemp(join(tmpdir(), "photoctl-companion-policy-"));
    const drive = join(root, "drive");
    const library = await initializeLibrary(join(root, "library"));
    try {
      await mkdir(drive);
      for (const extension of ["ARW", "JPG"])
        await copyFile(
          resolve(`fixtures/camera/DSC08819.${extension}`),
          join(drive, `${extension === "JPG" ? "FRAME" : "frame"}.${extension}`),
        );
      const result = await dispatch(
        {
          verb: "import",
          args: [drive, "--link", "--companions", mode],
          cwd: root,
          env: {
            noDaemon: true,
            cacheRoot: join(root, "cache"),
            volumeMap: `${drive}=drive:online`,
          },
        },
        { version: "test", library: library.handle },
      );
      expect(result).toMatchObject({ ok: true, data: { imported: count } });
      expect(
        (
          await library.handle.query<{ kind: string }>("SELECT kind FROM originals ORDER BY kind")
        ).rows.map((row) => row.kind),
      ).toEqual(kinds);
      if (mode === "both") {
        const ids = (result as { data: { ids: string[] } }).data.ids;
        const written = await dispatch(
          {
            verb: "xmp",
            args: ["write", ...ids],
            cwd: root,
            env: { noDaemon: true, volumeMap: `${drive}=drive:online` },
          },
          { version: "test", library: library.handle },
        );
        expect(written).toMatchObject({
          ok: false,
          results: ids.map((id) => ({ id, ok: false, code: "usage" })),
        });
        await expect(stat(join(drive, "frame.xmp"))).rejects.toMatchObject({ code: "ENOENT" });
        await writeFile(join(drive, "frame.xmp"), "Existing camera sidecar must not be touched");
        for (const args of [
          ["write", ...ids],
          ["sync", ...ids, "--read"],
        ]) {
          const refused = await dispatch(
            {
              verb: "xmp",
              args,
              cwd: root,
              env: { noDaemon: true, volumeMap: `${drive}=drive:online` },
            },
            { version: "test", library: library.handle },
          );
          expect(refused).toMatchObject({
            ok: false,
            results: ids.map((id) => ({ id, ok: false, code: "usage" })),
          });
        }
        expect(await readFile(join(drive, "frame.xmp"), "utf8")).toBe(
          "Existing camera sidecar must not be touched",
        );
      }
    } finally {
      await library.handle.close();
      await rm(root, { recursive: true });
    }
  },
  30_000,
);

test("failure copying the JPEG rolls back the already copied RAW and pair publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-paired-copy-failure-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  const stem = "a".repeat(251);
  const destination = join(library.handle.path, "originals", "2026-06-13");
  try {
    await mkdir(drive);
    await mkdir(destination, { recursive: true });
    for (const extension of ["ARW", "JPG"])
      await copyFile(
        resolve(`fixtures/camera/DSC08819.${extension}`),
        join(drive, `${stem}.${extension}`),
      );
    // The existing JPEG forces a collision suffix beyond the filesystem's name limit,
    // after the valid, full-length RAW filename has already been copied.
    await writeFile(join(destination, `${stem}.JPG`), "pre-existing delivery must survive");
    const result = await dispatch(
      {
        verb: "import",
        args: [drive, "--copy"],
        cwd: root,
        env: { noDaemon: true, cacheRoot: join(root, "cache"), volumeMap: `${drive}=drive:online` },
      },
      { version: "test", library: library.handle },
    );
    expect(result).toMatchObject({ ok: false });
    expect((await library.handle.query("SELECT id FROM photos")).rows).toEqual([]);
    expect((await library.handle.query("SELECT id FROM originals")).rows).toEqual([]);
    expect((await library.handle.query("SELECT id FROM files")).rows).toEqual([]);
    expect(await readdir(destination)).toEqual([`${stem}.JPG`]);
    expect(await readFile(join(destination, `${stem}.JPG`), "utf8")).toBe(
      "pre-existing delivery must survive",
    );
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("paired copy retains both original byte streams and logical removal trashes both", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-paired-copy-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  try {
    await mkdir(drive);
    for (const extension of ["ARW", "JPG"])
      await copyFile(
        resolve(`fixtures/camera/DSC08819.${extension}`),
        join(drive, `frame.${extension}`),
      );
    const request = {
      verb: "import",
      args: [drive, "--copy"],
      cwd: root,
      env: {
        noDaemon: true,
        cacheRoot: join(root, "cache"),
        volumeMap: `${root}=paired-drive:online`,
      },
    };
    const imported = await dispatch(request, { version: "test", library: library.handle });
    expect(imported).toMatchObject({ ok: true, data: { imported: 1 } });
    const id = (imported as { data: { ids: string[] } }).data.ids[0];
    const copies = await library.handle.query<{ rel_path: string; kind: string }>(
      "SELECT f.rel_path, o.kind FROM files f JOIN originals o ON o.id = f.original_id ORDER BY o.kind",
    );
    expect(copies.rows.map((row) => row.kind)).toEqual(["jpeg", "raw"]);
    for (const row of copies.rows)
      expect(await fullFileHash(join(library.handle.path, row.rel_path))).toBe(
        await fullFileHash(join(drive, `frame.${row.kind === "raw" ? "ARW" : "JPG"}`)),
      );
    const removed = await dispatch(
      { ...request, verb: "remove", args: [id, "--from-disk"] },
      { version: "test", library: library.handle },
    );
    expect(removed).toMatchObject({ ok: true });
    expect((await library.handle.query("SELECT id FROM originals")).rows).toEqual([]);
    for (const extension of ["ARW", "JPG"])
      expect(await fullFileHash(join(drive, `frame.${extension}`))).toBe(
        await fullFileHash(resolve(`fixtures/camera/DSC08819.${extension}`)),
      );
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);
