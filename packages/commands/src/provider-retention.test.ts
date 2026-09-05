import { initializeLibrary, createBackup, openLibrary } from "@photoctl/library";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import { restoreCommand } from "./handlers/library-lifecycle.js";

test.each([
  ["wrongaspect", "corrupt"],
  ["wrongaspect", "intact"],
  ["wrongaspect", "missing"],
  ["normal", "intact"],
  ["commit-failure", "intact"],
  ["cache-failure", "intact"],
] as const)(
  "source-less generation retains its exact %s response with %s backup files",
  async (mode, backupFiles) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-paid-retention-"));
    const handle = (await initializeLibrary(join(directory, "library"))).handle;
    let handleClosed = false;
    let calls = 0;
    const gateway = await startGatewayFixture(0, {
      imageMode: mode === "wrongaspect" ? "wrongaspect" : "normal",
      onRequest: () => {
        calls += 1;
      },
    });
    try {
      if (mode === "cache-failure") await writeFile(join(directory, "cache"), "not a directory");
      if (mode === "commit-failure") {
        await handle.query(
          "CREATE FUNCTION reject_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced revision failure'; END $$",
        );
        await handle.query(
          "CREATE TRIGGER reject_revision BEFORE INSERT ON document_revisions FOR EACH ROW EXECUTE FUNCTION reject_revision()",
        );
      }
      const address = gateway.address();
      if (!address || typeof address === "string") throw new Error("Fixture unavailable");
      const result = await dispatch(
        {
          verb: "generate",
          args: ["--prompt", "a blue vase", "--size", "4x4"],
          cwd: directory,
          env: {
            noDaemon: true,
            cacheRoot: join(directory, "cache"),
            gatewayApiKey: "fixture",
            gatewayUrl: `http://127.0.0.1:${address.port}`,
          },
        },
        { version: "test", library: handle },
      );
      expect(result).toMatchObject(mode === "normal" ? { ok: true } : { ok: false });
      const attempts = await handle.query<{
        id: string;
        state: string;
        original_artifact_hash: string;
        w: number;
        h: number;
      }>(
        `SELECT attempt.id, attempt.state, attempt.original_artifact_hash, artifact.w, artifact.h FROM provider_image_attempts attempt JOIN image_artifacts artifact ON artifact.artifact_hash = attempt.original_artifact_hash`,
      );
      const width = mode === "wrongaspect" ? 5 : 4;
      expect(attempts.rows).toEqual([
        {
          id: expect.any(String),
          state:
            mode === "wrongaspect"
              ? "rejected"
              : mode === "commit-failure" || mode === "cache-failure"
                ? "failed"
                : "committed",
          original_artifact_hash: expect.stringMatching(/^a_[a-f0-9]{64}$/),
          w: width,
          h: 4,
        },
      ]);
      const attempt = attempts.rows[0]!;
      const path = join(
        handle.path,
        "artifacts",
        "sha256",
        attempt.original_artifact_hash.slice(2, 4),
        `${attempt.original_artifact_hash}.png`,
      );
      const expected = await sharp({
        create: { width, height: 4, channels: 4, background: "#336699ff" },
      })
        .png()
        .toBuffer();
      expect(await readFile(path)).toEqual(expected);
      const listed = await dispatch(
        {
          verb: "graph",
          args: ["attempts", "--limit", "1"],
          cwd: directory,
          env: { noDaemon: true },
        },
        { version: "test", library: handle },
      );
      expect(listed).toMatchObject({
        ok: true,
        data: {
          attempts: [
            {
              id: attempt.id,
              state: attempt.state,
              original: { artifact_hash: attempt.original_artifact_hash, recorded_available: true },
            },
          ],
          next_cursor: null,
        },
      });
      const inspected = await dispatch(
        { verb: "graph", args: ["attempt", attempt.id], cwd: directory, env: { noDaemon: true } },
        { version: "test", library: handle },
      );
      expect(inspected).toMatchObject({
        ok: true,
        data: {
          id: attempt.id,
          request: {
            prompt: "a blue vase",
            provider_prompt: "a blue vase",
            applied_controls: { reference: false, init: "original" },
            route: "generations",
            dimensions: { w: 4, h: 4 },
          },
          original: { path, w: width, h: 4 },
        },
      });
      if (mode !== "normal") {
        if (mode === "wrongaspect")
          expect(inspected).toMatchObject({
            data: {
              provenance: {
                schema: 1,
                request_id: expect.any(String),
                transport_attempts: 1,
                cost_usd: null,
              },
              outcome: { schema: 1, code: "provider_whole_frame", retention_failed: false },
            },
          });
        expect(result).toMatchObject({ data: { attempt_id: attempt.id } });
        if (mode === "cache-failure")
          expect(result).toMatchObject({
            code: "volume_readonly",
            data: { path: expect.any(String) },
          });
        expect((await handle.query("SELECT id FROM photos")).rows).toEqual([]);
      } else {
        const executions = await handle.query<{
          photo_id: string;
          node_id: string;
          provider_image_attempt_id: string;
        }>(
          "SELECT photo_id, node_id, provider_image_attempt_id FROM node_executions WHERE NOT deterministic",
        );
        expect(executions.rows).toEqual([
          {
            photo_id: expect.any(String),
            node_id: expect.any(String),
            provider_image_attempt_id: attempt.id,
          },
        ]);
        const execution = executions.rows[0]!;
        const node = await dispatch(
          {
            verb: "graph",
            args: ["node", execution.photo_id, execution.node_id],
            cwd: directory,
            env: { noDaemon: true },
          },
          { version: "test", library: handle },
        );
        expect(node).toMatchObject({
          ok: true,
          data: { executions: [{ provider_image_attempt_id: attempt.id }] },
        });
        const second = await dispatch(
          {
            verb: "generate",
            args: ["--prompt", "a blue vase", "--size", "4x4"],
            cwd: directory,
            env: {
              noDaemon: true,
              cacheRoot: join(directory, "cache"),
              gatewayApiKey: "fixture",
              gatewayUrl: `http://127.0.0.1:${address.port}`,
            },
          },
          { version: "test", library: handle },
        );
        expect(second).toMatchObject({
          ok: false,
          data: {
            reason: "The generated pixels already exist in this library",
            attempt_id: expect.any(String),
          },
        });
        const independent = await handle.query<{ id: string; original_artifact_hash: string }>(
          "SELECT id, original_artifact_hash FROM provider_image_attempts ORDER BY created_at DESC, id DESC",
        );
        expect(independent.rows).toEqual([
          { id: expect.any(String), original_artifact_hash: attempt.original_artifact_hash },
          { id: attempt.id, original_artifact_hash: attempt.original_artifact_hash },
        ]);
        expect(independent.rows[0]!.id).not.toBe(attempt.id);
        await handle.query(
          "UPDATE provider_image_attempts SET created_at = CASE WHEN id = $1 THEN '2026-01-01T00:00:00.000001Z'::timestamptz ELSE '2026-01-01T00:00:00.000002Z'::timestamptz END",
          [attempt.id],
        );
        const firstPage = await dispatch(
          {
            verb: "graph",
            args: ["attempts", "--limit", "1"],
            cwd: directory,
            env: { noDaemon: true },
          },
          { version: "test", library: handle },
        );
        expect(firstPage).toMatchObject({
          ok: true,
          data: { attempts: [{ id: independent.rows[0]!.id }], next_cursor: expect.any(String) },
        });
        const cursor = (firstPage.data as { next_cursor: string }).next_cursor;
        const secondPage = await dispatch(
          {
            verb: "graph",
            args: ["attempts", "--limit", "1", "--cursor", cursor],
            cwd: directory,
            env: { noDaemon: true },
          },
          { version: "test", library: handle },
        );
        expect(secondPage).toMatchObject({
          ok: true,
          data: { attempts: [{ id: attempt.id }], next_cursor: null },
        });
        await rm(path);
        const recorded = await dispatch(
          { verb: "graph", args: ["attempts"], cwd: directory, env: { noDaemon: true } },
          { version: "test", library: handle },
        );
        expect(recorded).toMatchObject({
          ok: true,
          data: {
            attempts: [
              { original: { recorded_available: true } },
              { original: { recorded_available: true } },
            ],
          },
        });
        const missing = await dispatch(
          { verb: "graph", args: ["attempt", attempt.id], cwd: directory, env: { noDaemon: true } },
          { version: "test", library: handle },
        );
        expect(missing).toMatchObject({
          ok: true,
          data: {
            state: "committed",
            original: { artifact_hash: attempt.original_artifact_hash, available: false },
          },
        });
        const shown = await dispatch(
          {
            verb: "show",
            args: [execution.photo_id],
            cwd: directory,
            env: { noDaemon: true, cacheRoot: join(directory, "cache") },
          },
          { version: "test", library: handle },
        );
        expect(shown).toMatchObject({ ok: true });
      }
      if (mode === "wrongaspect") {
        const backup = (await createBackup(handle)).path;
        if (backupFiles === "corrupt")
          await writeFile(path, "corrupt original after metadata-only backup");
        else if (backupFiles === "missing") await rm(path);
        await handle.close();
        handleClosed = true;
        expect(
          await restoreCommand(
            ["--path", handle.path, "--from", backup],
            { noDaemon: true },
            directory,
          ),
        ).toMatchObject({ ok: true });
        const restored = await openLibrary(handle.path);
        try {
          const detail = await dispatch(
            {
              verb: "graph",
              args: ["attempt", attempt.id],
              cwd: directory,
              env: { noDaemon: true },
            },
            { version: "test", library: restored },
          );
          expect(detail).toMatchObject({
            ok: true,
            data: {
              id: attempt.id,
              state: "rejected",
              original: {
                artifact_hash: attempt.original_artifact_hash,
                available: backupFiles === "intact",
              },
            },
          });
          expect(
            (
              await restored.query(
                "SELECT artifact_available FROM image_artifacts WHERE artifact_hash = $1",
                [attempt.original_artifact_hash],
              )
            ).rows,
          ).toEqual([{ artifact_available: backupFiles === "intact" }]);
          expect((await restored.query("SELECT id FROM photos")).rows).toEqual([]);
          if (backupFiles === "corrupt")
            expect(await readFile(path, "utf8")).toBe(
              "corrupt original after metadata-only backup",
            );
          else if (backupFiles === "missing")
            await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
          else expect(await readFile(path)).toEqual(expected);
          await writeFile(path, expected);
          const repaired = await dispatch(
            {
              verb: "graph",
              args: ["attempt", attempt.id],
              cwd: directory,
              env: { noDaemon: true },
            },
            { version: "test", library: restored },
          );
          expect(repaired).toMatchObject({ ok: true, data: { original: { available: true } } });
        } finally {
          await restored.close();
        }
      }
      expect(calls).toBe(mode === "normal" ? 2 : 1);
    } finally {
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      if (!handleClosed) await handle.close();
      await rm(directory, { recursive: true });
    }
  },
);
