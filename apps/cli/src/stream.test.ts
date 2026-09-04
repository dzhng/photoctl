import { execFile } from "node:child_process";
import { execute } from "@photoctl/commands";
import { initializeLibrary, newLibraryEntityId } from "@photoctl/library";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);

test.each([
  ["without the daemon", true],
  ["through the daemon", false],
])(
  "list --stream writes each row as bare NDJSON %s",
  async (_name, noDaemon) => {
    const root = await mkdtemp(join(tmpdir(), "photoctl-stream-"));
    const mount = join(root, "drive");
    const initialized = await initializeLibrary(join(root, "library"));
    const ids = [newLibraryEntityId(), newLibraryEntityId()];
    try {
      await mkdir(mount);
      await initialized.handle.query(
        `INSERT INTO volumes (uuid, label, last_mount, last_seen)
       VALUES ('stream-volume', 'drive', $1, now())`,
        [mount],
      );
      for (const [index, id] of ids.entries()) {
        const name = `${index + 1}.jpg`;
        await writeFile(join(mount, name), `file ${index}`);
        await initialized.handle.query(
          `INSERT INTO photos (id, content_key, size, w, h, orientation, shot_at)
         VALUES ($1, $2, 1, 1, 1, 1, $3)`,
          [id, `ck_400000000000000${index}`, `2025-01-01T1${index}:00:00Z`],
        );
        await initialized.handle.query(
          `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
         VALUES ($1, $2, 'stream-volume', $3, now())`,
          [newLibraryEntityId(), id, name],
        );
      }
      await initialized.handle.close();

      const { stdout } = await execFileAsync(
        process.execPath,
        [resolve("apps/cli/dist/bin.js"), "list", "--stream"],
        {
          env: {
            ...process.env,
            PHOTOCTL_NO_DAEMON: noDaemon ? "1" : "0",
            PHOTOCTL_LIBRARY: join(root, "library"),
            PHOTOCTL_VOLUME_MAP: `${mount}=stream-volume:online`,
          },
        },
      );
      const rows = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(rows.map((row) => row.id)).toEqual(ids);
      expect(rows.every((row) => row.schema === undefined && row.ok === undefined)).toBe(true);

      let commandSettled = false;
      const streamed: unknown[] = [];
      const deliveryOrder: string[] = [];
      const execution = await execute(
        {
          verb: "list",
          args: ["--stream"],
          cwd: root,
          env: {
            noDaemon,
            libraryPath: join(root, "library"),
            volumeMap: `${mount}=stream-volume:online`,
          },
        },
        {
          version: "0.1.0",
          stream: async (row) => {
            expect(commandSettled).toBe(false);
            const index = streamed.length;
            deliveryOrder.push(`start:${index}`);
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
            streamed.push(row);
            deliveryOrder.push(`end:${index}`);
          },
        },
      );
      commandSettled = true;
      expect(streamed).toHaveLength(2);
      expect(deliveryOrder).toEqual(["start:0", "end:0", "start:1", "end:1"]);
      expect(execution.stream).toEqual([]);
      expect(execution.envelope).toMatchObject({
        ok: true,
        data: { rows: [], total: 2 },
      });
      if (!noDaemon) {
        await execute(
          {
            verb: "daemon",
            args: ["stop"],
            cwd: root,
            env: { noDaemon: false, libraryPath: join(root, "library") },
          },
          { version: "0.1.0" },
        );
      }
    } finally {
      await initialized.handle.close().catch(() => undefined);
      await rm(root, { recursive: true });
    }
  },
  30_000,
);
