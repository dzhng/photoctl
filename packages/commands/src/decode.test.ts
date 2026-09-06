import { chmod, link, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { dispatch } from "./dispatch.js";

test.each(["output", "occupied", "hardAlias", "symbolicAlias", "source"] as const)(
  "decode publishes a new TIFF without replacing %s",
  async (target) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-decode-no-clobber-"));
    const libraryPath = join(directory, "library");
    const source = join(directory, "source.png");
    const hardAlias = join(directory, "hard-alias.png");
    const symbolicAlias = join(directory, "symbolic-alias.png");
    const output = join(directory, "decoded.tif");
    const occupied = join(directory, "occupied.tif");
    const initialized = await initializeLibrary(libraryPath);
    try {
      await sharp({ create: { width: 4, height: 3, channels: 3, background: "#456" } })
        .png()
        .toFile(source);
      const originalBytes = await readFile(source);
      await link(source, hardAlias);
      await symlink(source, symbolicAlias);
      await writeFile(occupied, "keep me");
      const env = {
        noDaemon: true,
        libraryPath,
        cacheRoot: join(directory, "cache"),
        volumeMap: `${directory}=fixture-volume:online`,
      };
      const context = { version: "test", library: initialized.handle };
      const imported = await dispatch(
        { verb: "import", args: [source, "--link"], cwd: directory, env },
        context,
      );
      if (!imported.ok || !("data" in imported)) throw new Error("import failed");
      const id = (imported.data as { ids: string[] }).ids[0];
      const decode = (destination: string) =>
        dispatch(
          {
            verb: "decode",
            args: [id, "--with", "file", "--to", destination],
            cwd: directory,
            env,
          },
          context,
        );
      expect(await decode(output)).toMatchObject({ ok: true, data: { file: output, w: 4, h: 3 } });
      expect(await sharp(output).metadata()).toMatchObject({
        format: "tiff",
        width: 4,
        height: 3,
        depth: "ushort",
      });
      const files = (await readdir(directory)).toSorted();
      const destination = { output, occupied, hardAlias, symbolicAlias, source }[target];
      const before = await readFile(destination);
      expect.soft(await decode(destination)).toMatchObject({ ok: false, code: "volume_readonly" });
      expect.soft(await readFile(destination)).toEqual(before);
      expect.soft(await readFile(source)).toEqual(originalBytes);
      expect.soft((await readdir(directory)).toSorted()).toEqual(files);
    } finally {
      await initialized.handle.close();
      await rm(directory, { recursive: true });
    }
  },
);

test("decode writes native decoder output through the shared 16-bit TIFF boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-decode-command-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const fixture = resolve("fixtures/a7c2.ARW");
  const helper = join(directory, "fake-helper.mjs");
  const output = join(directory, "decoded.tif");
  await writeFile(
    helper,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "probe") console.log(JSON.stringify({supported:true,supportedDecoderVersions:["8"],decoderVersion:"8",nativeWidth:7008,nativeHeight:4672,highlightReconstructionMethod:"ciraw-highlight-v1"}));
else {
  writeFileSync(args[args.indexOf("--output") + 1], Buffer.from(new Float32Array([0, 0.5, 1, 1, 0.5, 0]).buffer));
  const reconstruct = args[args.indexOf("--highlight-reconstruction") + 1] === "reconstruct";
  console.log(JSON.stringify({width:2,height:1,channels:3,space:"scene-linear-rec2020",orientationApplied:true,wireFormat:"rgb-f32le",decoderVersion:"8",highlightReconstruction:reconstruct ? "applied" : "disabled",highlightReconstructionMethod:reconstruct ? "ciraw-highlight-v1" : undefined}));
}
`,
  );
  await chmod(helper, 0o755);
  const initialized = await initializeLibrary(libraryPath);
  const daemonContext = { version: "test", library: initialized.handle };
  try {
    const imported = await dispatch(
      {
        verb: "import",
        args: [fixture, "--link"],
        cwd: process.cwd(),
        env: {
          noDaemon: true,
          libraryPath,
          cacheRoot,
          volumeMap: `${process.cwd()}=fixture-volume:online`,
        },
      },
      daemonContext,
    );
    expect(imported).toMatchObject({ ok: true });
    const id = (imported as { data: { ids: string[] } }).data.ids[0];

    const decoded = await dispatch(
      {
        verb: "decode",
        args: [id, "--with", "ciraw", "--scale", "0.25", "--to", output],
        cwd: directory,
        env: {
          noDaemon: true,
          libraryPath,
          cacheRoot,
          volumeMap: `${process.cwd()}=fixture-volume:online`,
          macHelperPath: helper,
        },
      },
      daemonContext,
    );
    expect(decoded).toMatchObject({
      schema: 1,
      ok: true,
      data: {
        id,
        decoder: "ciraw",
        file: output,
        w: 2,
        h: 1,
        space: "scene-linear-rec2020",
        treatment: {
          requested: "reconstruct",
          status: "applied",
          method: "ciraw-highlight-v1",
          scale: 0.25,
        },
      },
      warnings: [],
    });
    expect(await sharp(output).metadata()).toMatchObject({
      format: "tiff",
      width: 2,
      height: 1,
      depth: "ushort",
    });

    const librawOutput = join(directory, "libraw.tif");
    const libraw = await dispatch(
      {
        verb: "decode",
        args: [
          id,
          "--with",
          "libraw",
          "--scale",
          "0.25",
          "--highlight-reconstruction",
          "disabled",
          "--to",
          librawOutput,
        ],
        cwd: directory,
        env: {
          noDaemon: true,
          libraryPath,
          cacheRoot,
          volumeMap: `${process.cwd()}=fixture-volume:online`,
        },
      },
      daemonContext,
    );
    expect(libraw).toMatchObject({
      schema: 1,
      ok: true,
      data: {
        id,
        decoder: "libraw",
        file: librawOutput,
        w: 1752,
        h: 1168,
        space: "scene-linear-rec2020",
        treatment: { requested: "disabled", status: "disabled", method: null, scale: 0.25 },
      },
      warnings: [],
    });
    expect(await sharp(librawOutput).metadata()).toMatchObject({
      format: "tiff",
      width: 1752,
      height: 1168,
      depth: "ushort",
      bitsPerSample: 16,
    });

    const doctor = await dispatch(
      {
        verb: "doctor",
        args: [],
        cwd: directory,
        env: { noDaemon: true, libraryPath, cacheRoot },
      },
      daemonContext,
    );
    expect(doctor).toMatchObject({
      schema: 1,
      ok: true,
      data: {
        decoders: [{ id: "ciraw" }, { id: "libraw", available: true, version: "0.22.2-Release" }],
      },
    });

    const fallbackOutput = join(directory, "fallback.tif");
    const fallback = await dispatch(
      {
        verb: "decode",
        args: [id, "--with", "auto", "--scale", "0.25", "--to", fallbackOutput],
        cwd: directory,
        env: {
          noDaemon: true,
          libraryPath,
          cacheRoot,
          volumeMap: `${process.cwd()}=fixture-volume:online`,
          macHelperPath: join(directory, "missing-helper"),
        },
      },
      daemonContext,
    );
    expect(fallback).toMatchObject({
      schema: 1,
      ok: true,
      data: {
        id,
        decoder: "libraw",
        file: fallbackOutput,
        space: "scene-linear-rec2020",
        treatment: {
          requested: "reconstruct",
          status: "applied",
          method: expect.any(String),
          scale: 0.25,
        },
      },
      warnings: [],
    });
    expect(await sharp(fallbackOutput).metadata()).toMatchObject({
      format: "tiff",
      depth: "ushort",
    });

    const offlineOutput = join(directory, "offline.tif");
    const offline = await dispatch(
      {
        verb: "decode",
        args: [id, "--with", "auto", "--scale", "0.25", "--to", offlineOutput],
        cwd: directory,
        env: {
          noDaemon: true,
          libraryPath,
          cacheRoot,
          volumeMap: `${process.cwd()}=fixture-volume:offline`,
          macHelperPath: helper,
        },
      },
      daemonContext,
    );
    expect(offline).toMatchObject({
      schema: 1,
      ok: true,
      data: {
        id,
        decoder: "file",
        file: offlineOutput,
        treatment: {
          requested: "reconstruct",
          status: "not-applicable",
          method: null,
          scale: 0.25,
        },
      },
      warnings: [{ code: "source_offline", id }],
    });

    const unavailable = await dispatch(
      {
        verb: "decode",
        args: [id, "--with", "ciraw", "--scale", "0.25", "--to", join(directory, "no.tif")],
        cwd: directory,
        env: {
          noDaemon: true,
          libraryPath,
          cacheRoot,
          volumeMap: `${process.cwd()}=fixture-volume:online`,
          macHelperPath: join(directory, "missing-helper"),
        },
      },
      daemonContext,
    );
    expect(unavailable).toMatchObject({
      schema: 1,
      ok: false,
      code: "decoder_unavailable",
      data: { decoder: "ciraw" },
    });

    // A decoder capability changing between probe and execution cannot publish
    // pixels under the treatment the command promised before decode.
    await writeFile(
      helper,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "probe") console.log(JSON.stringify({supported:true,supportedDecoderVersions:["8"],decoderVersion:"8",highlightReconstructionMethod:"ciraw-highlight-v1"}));
else {
  writeFileSync(args[args.indexOf("--output") + 1], Buffer.from(new Float32Array([0, 0.5, 1]).buffer));
  console.log(JSON.stringify({width:1,height:1,channels:3,space:"scene-linear-rec2020",orientationApplied:true,wireFormat:"rgb-f32le",decoderVersion:"8",highlightReconstruction:"unsupported"}));
}
`,
    );
    const changedOutput = join(directory, "changed-capability.tif");
    const changed = await dispatch(
      {
        verb: "decode",
        args: [id, "--with", "ciraw", "--to", changedOutput],
        cwd: directory,
        env: {
          noDaemon: true,
          libraryPath,
          cacheRoot,
          volumeMap: `${process.cwd()}=fixture-volume:online`,
          macHelperPath: helper,
        },
      },
      daemonContext,
    );
    expect(changed).toMatchObject({ ok: false, code: "decoder_unavailable" });
    await expect(sharp(changedOutput).metadata()).rejects.toThrow();
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
}, 120_000);
