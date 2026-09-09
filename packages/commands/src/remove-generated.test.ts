import { initializeLibrary } from "@photoctl/library";
import { generateDataSchema } from "@photoctl/protocol";
import { FAKE_IMAGE_EDIT_MODEL } from "@photoctl/providers";
import { retainedArtifacts } from "@photoctl/render";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test("removing one generated photo preserves shared originals and the other photo without provider replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-remove-generated-"));
  const handle = (await initializeLibrary(join(directory, "library"))).handle;
  let calls = 0;
  const gateway = await startGatewayFixture(0, {
    imageMode: "smallerdims",
    onRequest: () => {
      calls += 1;
    },
  });
  try {
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("No gateway address");
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
    const firstResult = await command("generate", [
      "--prompt",
      "a blue vase",
      "--size",
      "8x8",
      "--model",
      FAKE_IMAGE_EDIT_MODEL,
    ]);
    expect(firstResult, JSON.stringify(firstResult)).toMatchObject({ ok: true });
    const first = generateDataSchema.parse(firstResult.data);
    const second = generateDataSchema.parse(
      (
        await command("generate", [
          "--prompt",
          "a blue vase",
          "--size",
          "8x8",
          "--model",
          FAKE_IMAGE_EDIT_MODEL,
          "--upscale",
        ])
      ).data,
    );
    expect(second.id).not.toBe(first.id);
    const originals = (
      await handle.query<{ id: string; photo_id: string; original_artifact_hash: string }>(
        `SELECT attempt.id, execution.photo_id, attempt.original_artifact_hash FROM provider_image_attempts attempt JOIN node_executions execution ON execution.provider_image_attempt_id = attempt.id WHERE attempt.request->>'operation' = 'generate' ORDER BY execution.photo_id`,
      )
    ).rows;
    expect(originals).toHaveLength(2);
    expect(originals[0]!.original_artifact_hash).toBe(originals[1]!.original_artifact_hash);
    expect(originals[0]!.id).not.toBe(originals[1]!.id);
    const removedAttempt = originals.find((row) => row.photo_id === second.id)!;
    const inspected = (await command("graph", ["attempt", removedAttempt.id])).data as {
      original: { path: string };
    };
    const originalBytes = await readFile(inspected.original.path);
    const callsBefore = calls;
    const before = (
      await handle.query("SELECT active_revision_id FROM photo_documents WHERE photo_id = $1", [
        first.id,
      ])
    ).rows;
    await handle.query(
      "CREATE FUNCTION reject_paid_photo_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced paid photo delete failure'; END $$",
    );
    await handle.query(
      "CREATE TRIGGER reject_paid_photo_delete BEFORE DELETE ON photos FOR EACH ROW EXECUTE FUNCTION reject_paid_photo_delete()",
    );
    await expect(command("remove", [second.id])).rejects.toThrow(
      "forced paid photo delete failure",
    );
    expect((await handle.query("SELECT id FROM photos ORDER BY id")).rows).toEqual(
      [first.id, second.id].sort().map((id) => ({ id })),
    );
    expect(await command("graph", ["attempt", removedAttempt.id])).toMatchObject({
      ok: true,
      data: {
        state: "committed",
        executions: [{ photo_id: second.id }],
        original: { available: true },
      },
    });
    await handle.query("DROP TRIGGER reject_paid_photo_delete ON photos");
    expect(await command("remove", [second.id])).toMatchObject({ ok: true });
    expect((await handle.query("SELECT id FROM photos")).rows).toEqual([{ id: first.id }]);
    expect(
      (
        await handle.query("SELECT active_revision_id FROM photo_documents WHERE photo_id = $1", [
          first.id,
        ])
      ).rows,
    ).toEqual(before);
    expect(await command("show", [first.id])).toMatchObject({ ok: true });
    expect(await command("graph", ["attempt", removedAttempt.id])).toMatchObject({
      ok: true,
      data: { state: "committed", executions: [], original: { available: true } },
    });
    expect(await readFile(inspected.original.path)).toEqual(originalBytes);
    expect(await retainedArtifacts(handle)).toContainEqual({
      artifactHash: removedAttempt.original_artifact_hash,
      available: true,
    });
    expect(calls).toBe(callsBefore);
  } finally {
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await handle.close();
    await rm(directory, { recursive: true });
  }
});
