import { initializeLibrary } from "@photoctl/library";
import { generateDataSchema, showDataSchema, exportResultSchema } from "@photoctl/protocol";
import { artifactPath, readArtifactLinear } from "@photoctl/render";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test.each([8, 9])(
  "standalone upscale at %s pixels survives show, replaced develop and export without replay",
  async (edge) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-generated-consumers-"));
    const handle = (await initializeLibrary(join(directory, "library"))).handle;
    let providerCalls = 0;
    const gateway = await startGatewayFixture(0, {
      imageMode: "smallerdims",
      onRequest: () => {
        providerCalls += 1;
      },
    });
    try {
      const address = gateway.address();
      if (!address || typeof address === "string") throw new Error("Missing gateway address");
      const env = {
        noDaemon: true,
        cacheRoot: join(directory, "cache"),
        gatewayApiKey: "fixture",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      };
      await handle.query(
        "INSERT INTO settings (key, value) VALUES ('providers', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [JSON.stringify({ upscale: { "photoctl/fake-upscale-v1": { configured: true } } })],
      );
      const command = async (verb: string, args: string[]) =>
        await dispatch({ verb, args, cwd: directory, env }, { version: "test", library: handle });
      const generated = generateDataSchema.parse(
        (
          await command("generate", [
            "--prompt",
            "a blue vase",
            "--size",
            `${edge}x${edge}`,
            "--upscale",
          ])
        ).data,
      );
      const paidBefore = (
        await handle.query(
          "SELECT execution_id, provider_image_attempt_id, output_artifact_hash FROM node_executions WHERE NOT deterministic ORDER BY execution_id",
        )
      ).rows;
      expect(paidBefore).toHaveLength(2);
      const attemptsBefore = (
        await handle.query(
          "SELECT id, state, original_artifact_hash FROM provider_image_attempts ORDER BY id",
        )
      ).rows;
      const callsBefore = providerCalls;
      const before = showDataSchema.parse(
        (await command("show", [generated.id, "--preview-size", "native"])).data,
      );
      expect(before.preview_info.actual).toMatchObject({ w: edge, h: edge });
      const pixels = async () => {
        const { artifact_hash } = (
          await handle.query<{ artifact_hash: string }>(
            `SELECT execution.output_artifact_hash AS artifact_hash FROM photo_documents document JOIN document_revision_roots root ON root.photo_id = document.photo_id AND root.revision_id = document.active_revision_id AND root.root_name = 'output' JOIN node_executions execution ON execution.photo_id = root.photo_id AND execution.node_id = root.node_id WHERE document.photo_id = $1`,
            [generated.id],
          )
        ).rows[0]!;
        return await readArtifactLinear(
          artifactPath(handle.path, artifact_hash, "tif"),
          artifact_hash,
        );
      };
      const original = await pixels();
      expect(original).toMatchObject({ w: edge, h: edge });
      expect(await command("develop", [generated.id, "--set", "exposure=-1"])).toMatchObject({
        ok: true,
      });
      const dark = showDataSchema.parse(
        (await command("show", [generated.id, "--preview-size", "native"])).data,
      );
      expect(dark.preview_info.actual).toMatchObject({ w: edge, h: edge });
      expect(dark.preview_info.render_hash).not.toBe(before.preview_info.render_hash);
      const half = await pixels();
      for (let index = 0; index < original.data.length; index += 1)
        expect(half.data[index]).toBeCloseTo(original.data[index] * 0.5, 5);
      expect(await command("develop", [generated.id, "--set", "exposure=-2"])).toMatchObject({
        ok: true,
      });
      const darker = showDataSchema.parse(
        (await command("show", [generated.id, "--preview-size", "native"])).data,
      );
      const quarter = await pixels();
      for (let index = 0; index < original.data.length; index += 1)
        expect(quarter.data[index]).toBeCloseTo(original.data[index] * 0.25, 5);
      const exported = await command("export", [
        generated.id,
        "--to",
        join(directory, "out"),
        "--format",
        "png",
      ]);
      expect(exported).toMatchObject({ ok: true });
      const delivery = exportResultSchema.parse((exported as { results: unknown[] }).results[0]);
      expect(delivery).toMatchObject({
        w: edge,
        h: edge,
        render_hash: darker.preview_info.render_hash,
      });
      expect(await sharp(delivery.file).metadata()).toMatchObject({ width: edge, height: edge });
      const previewStats = await sharp(darker.preview).stats();
      const exportStats = await sharp(delivery.file).stats();
      for (let channel = 0; channel < 3; channel += 1)
        expect(
          Math.abs(previewStats.channels[channel]!.mean - exportStats.channels[channel]!.mean),
        ).toBeLessThan(2);
      expect(
        await command("develop", [
          generated.id,
          "--set",
          `crop=${JSON.stringify({ x: -2, y: -2, w: edge + 4, h: edge + 4 })}`,
        ]),
      ).toMatchObject({ ok: true });
      const exterior = showDataSchema.parse(
        (await command("show", [generated.id, "--preview-size", "native"])).data,
      );
      expect(exterior.preview_info.actual).toMatchObject({ w: edge + 4, h: edge + 4 });
      expect(exterior.preview_info.base_to_view).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 2, f: 2 });
      const expanded = await pixels();
      for (let y = 0; y < edge; y++)
        for (let x = 0; x < edge; x++)
          for (let channel = 0; channel < 3; channel++)
            expect(expanded.data[((y + 2) * (edge + 4) + x + 2) * 3 + channel]).toBe(
              quarter.data[(y * edge + x) * 3 + channel],
            );
      expect(expanded.data.slice(0, (edge + 4) * 3)).toEqual(new Float32Array((edge + 4) * 3));
      const exteriorExport = await command("export", [
        generated.id,
        "--to",
        join(directory, "exterior"),
        "--format",
        "png",
      ]);
      expect(exteriorExport).toMatchObject({ ok: true });
      const exteriorDelivery = exportResultSchema.parse(
        (exteriorExport as { results: unknown[] }).results[0],
      );
      expect(exteriorDelivery).toMatchObject({ w: edge + 4, h: edge + 4 });
      expect(await sharp(exteriorDelivery.file).metadata()).toMatchObject({
        width: edge + 4,
        height: edge + 4,
      });
      expect(
        (
          await handle.query(
            "SELECT execution_id, provider_image_attempt_id, output_artifact_hash FROM node_executions WHERE NOT deterministic ORDER BY execution_id",
          )
        ).rows,
      ).toEqual(paidBefore);
      expect(providerCalls).toBe(callsBefore);
      expect(
        (
          await handle.query(
            "SELECT id, state, original_artifact_hash FROM provider_image_attempts ORDER BY id",
          )
        ).rows,
      ).toEqual(attemptsBefore);
    } finally {
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await handle.close();
      await rm(directory, { recursive: true });
    }
  },
);
