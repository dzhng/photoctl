import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { initializeLibrary } from "@photoctl/library";
import {
  createMaskLayers,
  rasterizeManualMask,
  evaluateGraphNode,
  loadActiveDocument,
  readActiveDevelopState,
  commitDevelopState,
  refineMaskLayer,
  transformLayer,
} from "@photoctl/render";
import sharp from "sharp";
import { expect, test } from "vitest";
import { runWorkbench } from "./run.js";

test.each([false, true])(
  "masks compares committed coverage with identified cached develop pixels (crop/rotate/offline=%s)",
  async (transformed) => {
    const cwd = await mkdtemp(join(tmpdir(), "photoctl-wb-masks-"));
    const libraryPath = join(cwd, "library");
    const library = (await initializeLibrary(libraryPath)).handle;
    const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c059";
    let closed = false;
    try {
      await library.query(
        `WITH inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation)
           VALUES ($1, $1, 8, 6, 1) RETURNING id)
         INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation)
         VALUES ($1, $1, 'image', 'ck_7890abcdef123459', 1, 8, 6, 1)`,
        [photoId],
      );
      const layer = (
        await createMaskLayers(library, libraryPath, {
          photoId,
          orientation: 1,
          layers: [
            {
              mask: rasterizeManualMask({ w: 8, h: 6 }, { kind: "box", bbox: [2, 2, 4, 2] }).mask,
              name: "Synthetic <edge>",
            },
          ],
        })
      ).layers[0]!;
      if (transformed)
        await commitDevelopState(
          library,
          await readActiveDevelopState(library, { photoId, orientation: 1 }),
          { crop: { x: 2, y: 0, w: 4, h: 4 }, rotate: 90, shadows: 40 },
        );
      const document = (await loadActiveDocument(library, photoId))!;
      const dimensions = transformed ? { w: 4, h: 3 } : { w: 8, h: 6 };
      const baseRequest = {
        database: library,
        libraryPath,
        photoId,
        nodeId: document.roots.base,
        developBaseDimensions: { w: 8, h: 6 },
        source: async () => ({
          image: {
            ...dimensions,
            data: new Float32Array(dimensions.w * dimensions.h * 3).fill(0.2),
            space: "scene-linear-rec2020",
            orientationApplied: true,
            whiteLevel: 1,
            blackLevel: 0,
            wbPreApplied: true,
          },
          provenance: {
            locator: transformed
              ? { kind: "pinned-preview", cache_path: "synthetic.jpg" }
              : { kind: "online-file", volume_uuid: "synthetic", rel_path: "source.jpg" },
            tier: transformed ? "pinned-preview" : "online-file",
            ...dimensions,
            decoderId: "synthetic",
            decoderVersion: "1",
          },
        }),
      } satisfies Parameters<typeof evaluateGraphNode>[0];
      const base = await evaluateGraphNode(baseRequest);
      if (!transformed) {
        await evaluateGraphNode({
          ...baseRequest,
          source: async () => {
            const original = await baseRequest.source();
            return {
              ...original,
              image: { ...original.image, w: 4, h: 3, data: new Float32Array(36).fill(0.8) },
              provenance: {
                ...original.provenance,
                w: 4,
                h: 3,
                locator: { kind: "pinned-preview", cache_path: "offline.jpg" },
                tier: "pinned-preview",
              },
            };
          },
        });
        expect((await evaluateGraphNode(baseRequest)).reused).toBe(true);
      }
      await library.close();
      closed = true;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "masks", photoId],
        { cwd, env: { ...process.env, PHOTOCTL_LIBRARY: libraryPath } },
      );
      const output = stdout.trim();
      const html = await readFile(output, "utf8");
      expect(output).toBe(await realpath(join(cwd, "out", "wb", "masks.html")));
      expect(html).toContain("Synthetic &lt;edge&gt;");
      expect(html).toContain(layer.artifactHash);
      expect(html).toContain(base.artifact.artifactHash);
      expect(html).toContain("not the historical SAM input");
      const images = [...html.matchAll(/src="data:image\/png;base64,([^"]+)"/gu)];
      expect(images).toHaveLength(3);
      const mask = await sharp(Buffer.from(images[1]![1]!, "base64"))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (transformed) {
        expect(html).toContain("Stale layer");
        expect([mask.info.width, mask.info.height]).toEqual([2, 2]);
        // Native Lanczos reduction retains fractional edge coverage; the quarter-turn moves
        // the bottom-half silhouette to the left, without thresholding the displayed mask.
        expect([0, 3, 6, 9].map((index) => mask.data[index]! > 127)).toEqual([
          true,
          false,
          true,
          false,
        ]);
        expect(mask.data[0]).toBeLessThan(255);
        expect(mask.data[3]).toBeGreaterThan(0);
      } else {
        expect([mask.info.width, mask.info.height]).toEqual([8, 6]);
        expect([...mask.data.subarray((2 * 8 + 2) * 3, (2 * 8 + 2) * 3 + 3)]).toEqual([
          255, 255, 255,
        ]);
        expect([...mask.data.subarray(0, 3)]).toEqual([0, 0, 0]);
        const overlay = await sharp(Buffer.from(images[2]![1]!, "base64")).raw().toBuffer();
        expect([...overlay.subarray((2 * 8 + 2) * 3, (2 * 8 + 2) * 3 + 3)]).toEqual([41, 229, 214]);
        expect([...overlay.subarray((2 * 8 + 1) * 3, (2 * 8 + 1) * 3 + 3)]).toEqual([41, 229, 214]);
        expect([...overlay.subarray(2 * 8 * 3, 2 * 8 * 3 + 3)]).toEqual([0, 0, 0]);
      }
    } finally {
      if (!closed) await library.close();
      await rm(cwd, { recursive: true });
    }
  },
);

test.each([false, true])(
  "mask inspection respects refined placement and empty coverage (empty=%s)",
  async (empty) => {
    const cwd = await mkdtemp(join(tmpdir(), "photoctl-wb-refined-mask-"));
    const libraryPath = join(cwd, "library");
    const library = (await initializeLibrary(libraryPath)).handle;
    const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c079";
    let closed = false;
    try {
      await library.query(
        `WITH inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation)
      VALUES ($1, $1, 8, 6, 1) RETURNING id)
      INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation)
      VALUES ($1, $1, 'image', 'ck_refinementinspect', 1, 8, 6, 1)`,
        [photoId],
      );
      const created = await createMaskLayers(library, libraryPath, {
        photoId,
        orientation: 1,
        layers: [
          {
            name: "Corrected selection",
            mask: rasterizeManualMask({ w: 8, h: 6 }, { kind: "box", bbox: [2, 2, 2, 2] }).mask,
          },
        ],
      });
      await refineMaskLayer(library, libraryPath, {
        photoId,
        layer: created.layers[0].layerId,
        operation: empty ? "subtract" : "replace",
        shape: { kind: "box", bbox: [2, 2, 2, 2] },
      });
      if (!empty)
        await transformLayer(library, libraryPath, {
          photoId,
          orientation: 1,
          layer: created.layers[0].layerId,
          relative: true,
          transform: { dx: 2, dy: 0, scale: 1, rotate: 0, flip: null, anchor: { x: 0, y: 0 } },
        });
      const document = (await loadActiveDocument(library, photoId))!;
      await evaluateGraphNode({
        database: library,
        libraryPath,
        photoId,
        nodeId: document.roots.base,
        source: async () => ({
          image: {
            w: 8,
            h: 6,
            data: new Float32Array(8 * 6 * 3).fill(0.2),
            space: "scene-linear-rec2020",
            orientationApplied: true,
            whiteLevel: 1,
            blackLevel: 0,
            wbPreApplied: true,
          },
          provenance: {
            locator: { kind: "online-file", volume_uuid: "synthetic", rel_path: "source.jpg" },
            tier: "online-file",
            w: 8,
            h: 6,
            decoderId: "synthetic",
            decoderVersion: "1",
          },
        }),
      });
      await library.close();
      closed = true;
      const path = await runWorkbench(["masks", photoId], cwd, { PHOTOCTL_LIBRARY: libraryPath });
      const html = await readFile(path, "utf8");
      const images = [...html.matchAll(/src="data:image\/png;base64,([^"]+)"/gu)];
      if (empty) {
        expect(html).toContain("No covered pixels in the current develop crop.");
        expect(images).toEqual([]);
      } else {
        const mask = await sharp(Buffer.from(images[1]![1]!, "base64"))
          .removeAlpha()
          .raw()
          .toBuffer();
        expect([...mask.subarray((2 * 8 + 4) * 3, (2 * 8 + 4) * 3 + 3)]).toEqual([255, 255, 255]);
        expect([...mask.subarray((2 * 8 + 2) * 3, (2 * 8 + 2) * 3 + 3)]).toEqual([0, 0, 0]);
      }
    } finally {
      if (!closed) await library.close();
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test.each([[[]], [["id", "extra"]]])(
  "masks accepts exactly one photo argument: %j",
  async (rest) => {
    await expect(runWorkbench(["masks", ...rest], process.cwd())).rejects.toThrow(
      "usage: wb masks <photo-id>",
    );
  },
);
