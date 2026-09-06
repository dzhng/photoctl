import { exportResultSchema, importDataSchema, showDataSchema } from "@photoctl/protocol";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

export function registerPairedOriginalsJourney(
  invoke: typeof spawnPhotoctl = spawnPhotoctl,
  title = "built CLI preserves unequal RAW/JPEG originals through editing, delivery and offline access",
) {
  test.each(["--link", "--copy"])(
    `${title}: %s`,
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), "photoctl-paired-journey-"));
      const sources = join(directory, "sources");
      const library = join(directory, "library");
      const env = {
        PHOTOCTL_CACHE: join(directory, "cache"),
        PHOTOCTL_VOLUME_MAP: `${directory}=fixture:online`,
        AI_GATEWAY_API_KEY: "",
      };
      const call = (args: string[]) => invoke(args, { libraryDir: library, env });
      const run = async (args: string[]) => {
        const result = await call(args);
        expect(result.code, `${args.join(" ")}: ${JSON.stringify(result.json)}`).toBe(0);
        return result.json;
      };
      try {
        await mkdir(sources);
        const hashes = new Map<string, string>();
        await Promise.all(
          ["ARW", "JPG"].map(async (extension) => {
            const original = resolve(`fixtures/camera/DSC00103.${extension}`);
            const manifest = JSON.parse(
              await readFile(
                resolve(`fixtures/camera/DSC00103${extension === "JPG" ? ".JPG" : ""}.json`),
                "utf8",
              ),
            );
            expect(await sha256(original)).toBe(manifest.sha256);
            hashes.set(original, manifest.sha256);
            const copied = join(sources, `frame.${extension}`);
            await copyFile(original, copied);
            hashes.set(copied, manifest.sha256);
          }),
        );
        await run(["init", "--path", library]);
        const importedResponse = await run(["import", sources, mode]);
        const imported = importDataSchema.parse(
          "data" in importedResponse ? importedResponse.data : undefined,
        );
        expect(imported).toMatchObject({
          imported: 1,
          skipped_conflicts: 0,
          skipped_unsupported: 0,
        });
        expect(imported.ids).toHaveLength(1);
        const id = imported.ids[0]!;
        const show = async (camera = false) => {
          const result = await run([
            "show",
            id,
            ...(camera ? ["--source", "camera-jpeg"] : []),
            "--preview-size",
            "320",
          ]);
          return showDataSchema.parse("data" in result ? result.data : undefined);
        };
        const initial = await show(true);
        expect(initial).toMatchObject({
          dims: { w: 7008, h: 4672, orientation: 1 },
          originals: [
            { kind: "raw", dims: { w: 3504, h: 2336 } },
            { kind: "jpeg", dims: { w: 7008, h: 4672 } },
          ],
        });
        const raw = initial.originals.find((original) => original.kind === "raw")!;
        const jpeg = initial.originals.find((original) => original.kind === "jpeg")!;
        expect(raw.id).not.toBe(jpeg.id);
        expect(initial.primary_original_id).toBe(raw.id);
        expect(initial.source_original_id).toBe(jpeg.id);
        await Promise.all(
          initial.originals.map(async (original) => {
            const locator = original.locators[0]!;
            const originalPath = join(mode === "--copy" ? library : directory, locator.path);
            const expected = hashes.get(
              join(sources, `frame.${original.kind === "raw" ? "ARW" : "JPG"}`),
            )!;
            expect(await sha256(originalPath)).toBe(expected);
            hashes.set(originalPath, expected);
          }),
        );
        const jpegPreviewHash = await sha256(initial.preview);
        const deliver = async (name: string, camera = false) => {
          const result = await run([
            "export",
            id,
            ...(camera ? ["--source", "camera-jpeg"] : []),
            "--to",
            join(directory, name),
            "--resize",
            "320",
          ]);
          expect(result).toMatchObject({
            summary: { ok: 1, failed: 0 },
            results: [{ id, ok: true, source_original_id: camera ? jpeg.id : raw.id }],
          });
          return exportResultSchema.parse("results" in result ? result.results[0] : undefined);
        };
        const before = await deliver("jpeg-before", true);
        await run(["develop", id, "--set", 'crop={"x":20,"y":30,"w":160,"h":120}', "rotate=90"]);
        const current = await show();
        expect(current).toMatchObject({
          source_original_id: raw.id,
          dims: { w: 3504, h: 2336, orientation: 1 },
          preview_info: { actual: { w: 120, h: 160 } },
        });
        const camera = await show(true);
        expect(camera).toMatchObject({
          render_hash: initial.render_hash,
          crop: null,
          source_original_id: jpeg.id,
        });
        expect(await sha256(camera.preview)).toBe(jpegPreviewHash);
        expect((await show()).render_hash).toBe(current.render_hash);
        const normal = await deliver("raw-edited");
        expect(normal).toMatchObject({ w: 120, h: 160, render_hash: current.render_hash });
        const after = await deliver("jpeg-after", true);
        expect(after).toMatchObject({ w: 320, render_hash: initial.render_hash });
        expect(await sha256(after.file)).toBe(await sha256(before.file));
        expect(await run(["list"])).toMatchObject({
          data: {
            total: 1,
            rows: [
              { id, primary_original_id: raw.id, originals: [{ id: raw.id }, { id: jpeg.id }] },
            ],
          },
        });
        const jpegPath = join(mode === "--copy" ? library : directory, jpeg.locators[0]!.path);
        const detached = join(directory, "detached.JPG");
        await rename(jpegPath, detached);
        const expectOffline = async (args: string[]) => {
          const result = await call(args);
          expect(result.code, JSON.stringify(result.json)).toBe(69);
          expect(result.json).toMatchObject({ ok: false, code: "file_offline" });
        };
        await expectOffline(["show", id, "--source", "camera-jpeg", "--preview-size", "320"]);
        await expectOffline([
          "export",
          id,
          "--source",
          "camera-jpeg",
          "--to",
          join(directory, "offline"),
        ]);
        expect((await show()).render_hash).toBe(current.render_hash);
        await rename(detached, jpegPath);
        expect((await show(true)).source_original_id).toBe(jpeg.id);
        expect(await run(["import", sources, mode])).toMatchObject({
          data: { imported: 0, already_present: 1, ids: [id] },
        });
        expect(
          (await show()).originals.map(({ id: originalId, kind }) => ({ id: originalId, kind })),
        ).toEqual([
          { id: raw.id, kind: "raw" },
          { id: jpeg.id, kind: "jpeg" },
        ]);
        await Promise.all(
          [...hashes].map(async ([path, expected]) => expect(await sha256(path)).toBe(expected)),
        );
      } finally {
        const stopped = await call(["daemon", "stop"]);
        expect(stopped.code, JSON.stringify(stopped.json)).toBe(0);
        await rm(directory, { recursive: true, force: true });
      }
    },
    60_000,
  );
}

async function sha256(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
