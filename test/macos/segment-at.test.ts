import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import type { ImportData, SegmentInstancesData } from "@photoctl/protocol";
import { artifactPath, readArtifactMask } from "@photoctl/render";
import { spawnPhotoctl, withLibrary } from "@photoctl/test-harness";
import fixture from "../../fixtures/a7c2.json";

test("real SAM selects the clicked photographic subject within independently authored bands", async () => {
  const models = process.env.PHOTOCTL_SAM_MODELS_DIR;
  expect(
    models,
    "Set PHOTOCTL_SAM_MODELS_DIR to the hash-pinned exported ONNX directory",
  ).toBeTruthy();
  await withLibrary(async (parent) => {
    const library = join(parent, "library");
    const env = {
      PHOTOCTL_CACHE: join(parent, "cache"),
      PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
    };
    expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
    await mkdir(join(library, "models"));
    for (const file of ["encoder.onnx", "decoder.onnx"]) {
      await copyFile(join(models!, file), join(library, "models", file));
    }
    const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
      libraryDir: library,
      env,
    });
    expect(imported.code, JSON.stringify(imported.json)).toBe(0);
    const id = (imported.json.data as ImportData).ids[0]!;
    for (const probe of fixture.sam_probes) {
      const result = await spawnPhotoctl(["segment", id, "--at", probe.at.join(",")], {
        libraryDir: library,
        env,
      });
      expect(result.code, JSON.stringify(result.json)).toBe(0);
      const data = result.json.data as SegmentInstancesData;
      expect(data.gateway_calls).toBe(0);
      const artifact = data.instances[0]!.mask.artifact_hash;
      const mask = await readArtifactMask(artifactPath(library, artifact, "tif"), artifact);
      const selected = mask.data.reduce((count, value) => count + value, 0);
      const area = (selected / (mask.w * mask.h)) * 100;
      expect(area, probe.label).toBeGreaterThanOrEqual(probe.min_area_pct);
      expect(area, probe.label).toBeLessThanOrEqual(probe.max_area_pct);
      expect(mask.data[probe.at[1]! * mask.w + probe.at[0]!], probe.label).toBe(1);
      for (const [x, y] of probe.outside) {
        expect(mask.data[y! * mask.w + x!], `${probe.label}: excluded ${x},${y}`).toBe(0);
      }
    }
  });
}, 180_000);
