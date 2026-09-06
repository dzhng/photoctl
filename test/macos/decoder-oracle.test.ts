import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { expect, test } from "vitest";

const executeFile = promisify(execFile);

test.each([undefined, "disabled"] as const)(
  "the public workbench proves CIRAW and LibRaw agree within G4: %s",
  async (treatment) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-oracle-test-"));
    const library = join(directory, "library");
    const cache = join(directory, "cache");
    const repository = resolve(import.meta.dirname, "../..");
    const env = {
      PHOTOCTL_NO_DAEMON: "1",
      PHOTOCTL_CACHE: cache,
      PHOTOCTL_VOLUME_MAP: `${repository}=fixture-volume:online`,
      PHOTOCTL_MAC_HELPER_PATH: join(repository, "helpers/mac/.build/debug/photoctl-mac"),
    };
    try {
      expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
      const imported = await spawnPhotoctl(
        ["import", join(repository, "fixtures/a7c2.ARW"), "--link"],
        {
          libraryDir: library,
          env,
        },
      );
      expect(imported.code).toBe(0);
      const id = (imported.json as { data: { ids: string[] } }).data.ids[0];
      const { stdout } = await executeFile(
        process.execPath,
        [
          join(repository, "apps/workbench/dist/cli.js"),
          "oracle",
          id,
          ...(treatment ? ["--highlight-reconstruction", treatment] : []),
        ],
        {
          cwd: directory,
          env: { ...process.env, ...env, PHOTOCTL_LIBRARY: library },
          encoding: "utf8",
        },
      );
      const report = stdout.trim();
      const evidence = JSON.parse(
        await readFile(join(directory, "out/wb/oracle", id, "oracle.json"), "utf8"),
      ) as {
        runDirectory: string;
        orientation: Array<{ width: number; height: number }>;
        verdict: { meanDeltaE00: number; p95DeltaE00: number; passed: boolean };
        treatments: Array<{
          decoder: string;
          treatment: { requested: string; status: string; method: string | null; scale: number };
        }>;
      };

      expect(await realpath(report)).toBe(
        await realpath(join(directory, "out/wb", `oracle-${id}.html`)),
      );
      expect(evidence.orientation).toEqual([
        { decoder: "file", width: 1752, height: 1168 },
        { decoder: "ciraw", width: 1752, height: 1168 },
        { decoder: "libraw", width: 1752, height: 1168 },
      ]);
      expect(evidence.verdict.passed).toBe(true);
      expect(evidence.verdict.meanDeltaE00).toBeLessThanOrEqual(2);
      expect(evidence.verdict.p95DeltaE00).toBeLessThanOrEqual(5);
      expect(evidence.treatments).toEqual([
        {
          decoder: "file",
          treatment: {
            decoderId: "file",
            decoderVersion: expect.any(String),
            requested: treatment ?? "reconstruct",
            status: "not-applicable",
            method: null,
            scale: 0.25,
          },
        },
        ...["ciraw", "libraw"].map((decoder) => ({
          decoder,
          treatment: {
            decoderId: decoder,
            decoderVersion: expect.any(String),
            requested: treatment ?? "reconstruct",
            status: treatment ? "disabled" : "applied",
            method: treatment ? null : expect.any(String),
            scale: 0.25,
          },
        })),
      ]);
      expect(typeof evidence.runDirectory).toBe("string");
      const firstTiff = await readFile(join(evidence.runDirectory, "ciraw.tif"));
      const firstEvidence = await readFile(join(evidence.runDirectory, "oracle.json"));
      await executeFile(
        process.execPath,
        [
          join(repository, "apps/workbench/dist/cli.js"),
          "oracle",
          id,
          "--highlight-reconstruction",
          treatment ? "reconstruct" : "disabled",
        ],
        {
          cwd: directory,
          env: { ...process.env, ...env, PHOTOCTL_LIBRARY: library },
          encoding: "utf8",
        },
      );
      const latest = JSON.parse(
        await readFile(join(directory, "out/wb/oracle", id, "oracle.json"), "utf8"),
      );
      expect(latest.runDirectory).not.toBe(evidence.runDirectory);
      expect((await readFile(join(evidence.runDirectory, "ciraw.tif"))).equals(firstTiff)).toBe(
        true,
      );
      expect(
        (await readFile(join(evidence.runDirectory, "oracle.json"))).equals(firstEvidence),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
