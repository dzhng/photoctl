import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { dispatch } from "./dispatch.js";

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
if (args[0] === "probe") console.log(JSON.stringify({supported:true,supportedDecoderVersions:["8"],decoderVersion:"8",nativeWidth:7008,nativeHeight:4672}));
else {
  writeFileSync(args[args.indexOf("--output") + 1], Buffer.from(new Float32Array([0, 0.5, 1, 1, 0.5, 0]).buffer));
  console.log(JSON.stringify({width:2,height:1,channels:3,space:"scene-linear-rec2020",orientationApplied:true,wireFormat:"rgb-f32le",decoderVersion:"8"}));
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
      data: { id, decoder: "ciraw", file: output, w: 2, h: 1, space: "scene-linear-rec2020" },
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
        args: [id, "--with", "libraw", "--scale", "0.25", "--to", librawOutput],
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
      data: { id, decoder: "libraw", file: fallbackOutput, space: "scene-linear-rec2020" },
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
      data: { id, decoder: "file", file: offlineOutput },
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
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
}, 120_000);
