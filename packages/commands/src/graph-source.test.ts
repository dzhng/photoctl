import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { dispatch } from "./dispatch.js";
import { rawTestHelper } from "@photoctl/test-harness";

test("online RAW graph renders use the native whole-file decoder with full provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-graph-raw-source-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const fixture = resolve("fixtures/a7c2.ARW");
  const output = join(directory, "linear.tif");
  const initialized = await initializeLibrary(libraryPath);
  try {
    const env = {
      noDaemon: true,
      macHelperPath: await rawTestHelper(directory, "applied"),
      libraryPath,
      cacheRoot,
      volumeMap: `${process.cwd()}=fixture-volume:online`,
    };
    const imported = await dispatch(
      { verb: "import", args: [fixture, "--link"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("import failed");
    const id = (imported.data as { ids: string[] }).ids[0];

    const doctor = await dispatch(
      { verb: "doctor", args: [], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    expect(doctor).toMatchObject({
      data: {
        decoders: expect.arrayContaining([{ id: "ciraw", available: true, version: "test" }]),
      },
    });

    const rendered = await dispatch(
      { verb: "render", args: [id, "--linear", "--to", output], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    expect(rendered).toMatchObject({
      ok: true,
      data: { w: 2, h: 1 },
      warnings: [],
    });
    const executions = await initialized.handle.query<{
      source_tier: string;
      decoder_id: string;
      decoder_version: string;
    }>(
      `SELECT source_tier, decoder_id, decoder_version
       FROM node_executions WHERE photo_id = $1 AND source_tier IS NOT NULL`,
      [id],
    );
    expect(executions.rows).toContainEqual({
      source_tier: "online-file",
      decoder_id: "ciraw",
      decoder_version: "test",
    });
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
}, 90_000);

test.each([false, true])(
  "a RAW overview rejects unavailable CIRAW instead of a JPEG (warm=%s)",
  async (warm) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-strict-raw-"));
    const { handle } = await initializeLibrary(join(directory, "library"));
    const env = {
      noDaemon: true,
      libraryPath: handle.path,
      cacheRoot: join(directory, "cache"),
      volumeMap: `${process.cwd()}=camera:online`,
      macHelperPath: warm
        ? await rawTestHelper(directory, "applied")
        : join(directory, "missing-helper"),
    };
    try {
      const imported = await dispatch(
        { verb: "import", args: [resolve("fixtures/a7c2.ARW"), "--link"], cwd: directory, env },
        { version: "test", library: handle },
      );
      if (!imported.ok || !("data" in imported)) throw new Error("import failed");
      const id = (imported.data as { ids: string[] }).ids[0];
      const show = () =>
        dispatch(
          { verb: "show", args: [id], cwd: directory, env },
          { version: "test", library: handle },
        );
      if (warm) {
        expect(await show()).toMatchObject({ ok: true });
        await writeFile(
          env.macHelperPath,
          "#!/usr/bin/env node\nconsole.log(JSON.stringify({supported:false,supportedDecoderVersions:[]}));\n",
        );
        expect(await show()).toMatchObject({ ok: false, code: "decoder_unavailable" });
        await rm(env.macHelperPath);
      }
      const shown = await dispatch(
        { verb: "show", args: [id], cwd: directory, env },
        { version: "test", library: handle },
      );
      expect(shown, JSON.stringify(shown)).toMatchObject({
        ok: false,
        code: "decoder_unavailable",
      });
      if (warm) {
        await rawTestHelper(directory, "applied");
        expect(await show()).toMatchObject({
          ok: true,
          data: { preview_info: { source_treatment: { decoderId: "ciraw", status: "applied" } } },
        });
      }
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("RAW decode failure cannot fall through to the pinned JPEG", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-raw-failure-"));
  const { handle } = await initializeLibrary(join(directory, "library"));
  const env = {
    noDaemon: true,
    libraryPath: handle.path,
    cacheRoot: join(directory, "cache"),
    volumeMap: `${process.cwd()}=camera:online`,
    macHelperPath: await rawTestHelper(directory, "failure"),
  };
  try {
    const imported = await dispatch(
      { verb: "import", args: [resolve("fixtures/a7c2.ARW"), "--link"], cwd: directory, env },
      { version: "test", library: handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("import failed");
    const id = (imported.data as { ids: string[] }).ids[0];
    const shown = await dispatch(
      { verb: "show", args: [id], cwd: directory, env },
      { version: "test", library: handle },
    );
    expect(shown).toMatchObject({ ok: false, code: "decoder_unavailable" });
    const rendered = await dispatch(
      {
        verb: "render",
        args: [id, "--linear", "--to", join(directory, "linear.tif")],
        cwd: directory,
        env,
      },
      { version: "test", library: handle },
    );
    expect(rendered).toMatchObject({ ok: false, code: "decoder_unavailable" });
    const exported = await dispatch(
      { verb: "export", args: [id, "--to", join(directory, "delivery")], cwd: directory, env },
      { version: "test", library: handle },
    );
    expect(exported).toMatchObject({ results: [{ id, ok: false, code: "decoder_unavailable" }] });
  } finally {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
});
