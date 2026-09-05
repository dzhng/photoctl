import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execute = promisify(execFile);

test("packed CLI starts its daemon and finds both packaged decoders outside the checkout", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "photoctl-install-"));
  const prefix = join(scratch, "prefix");
  const library = join(scratch, "library");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PHOTOCTL_LIBRARY: library,
    PHOTOCTL_CACHE: join(scratch, "cache"),
  };
  delete env.PHOTOCTL_DAEMON_ENTRY;
  delete env.PHOTOCTL_MAC_HELPER_PATH;
  delete env.PHOTOCTL_NO_DAEMON;
  delete env.NODE_PATH;
  const binary = join(prefix, "bin/photoctl");
  let daemonPid: number | undefined;
  const run = async (args: string[]) =>
    JSON.parse((await execute(binary, args, { cwd: scratch, env })).stdout);
  try {
    await execute("bun", ["run", "pack", join(scratch, "tarballs")], {
      cwd: resolve("."),
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    await execute(resolve("scripts/install-clean.sh"), [prefix, join(scratch, "tarballs")], {
      cwd: scratch,
      timeout: 180_000,
    });
    const { version } = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    expect((await run(["--version"])).data.version).toBe(version);
    const helper = join(
      prefix,
      `lib/node_modules/@photoctl/mac-helper-darwin-${process.arch}/photoctl-mac`,
    );
    expect((await execute(helper, ["--version"], { cwd: scratch, env })).stdout.trim()).toBe(
      `photoctl-mac ${version}`,
    );
    expect((await run(["init", "--path", library])).ok).toBe(true);
    daemonPid = (await run(["daemon", "status"])).data.pid;
    expect(daemonPid).toBeGreaterThan(0);
    const doctor = await run(["doctor"]);
    expect(doctor.ok).toBe(true);
    expect(doctor.data.decoders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ciraw", available: true }),
        expect.objectContaining({ id: "libraw", available: true }),
      ]),
    );
    expect(
      (await readdir(join(scratch, "tarballs"))).filter((name) => name.endsWith(".tgz")),
    ).toHaveLength(3);
    const source = join(scratch, "source");
    const delivery = join(scratch, "delivery");
    await execute("node", ["fixtures/tools/drive.mjs", "--count", "10", "--out", source]);
    await execute(resolve("scripts/gold-exam.sh"), [source, "--out", delivery], {
      cwd: scratch,
      env: {
        ...env,
        PATH: `${join(prefix, "bin")}:${process.env.PATH}`,
        PHOTOCTL_VOLUME_MAP: `${scratch}=fixture-volume:online`,
      },
      timeout: 600_000,
    });
    const gold = JSON.parse(await readFile(join(delivery, "gold-exam-report.json"), "utf8"));
    expect(gold.import.data.imported).toBe(10);
    expect(gold.develop.summary.ok).toBe(3);
    expect(gold.export.summary.ok).toBe(10);
    expect(
      gold.export.results.every((item: { render_hash: string }) =>
        /^r_[0-9a-f]{64}$/u.test(item.render_hash),
      ),
    ).toBe(true);
  } finally {
    await execute(binary, ["daemon", "stop"], { cwd: scratch, env }).catch(() => {
      if (daemonPid) {
        try {
          process.kill(daemonPid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    });
    await rm(scratch, { recursive: true, force: true });
  }
}, 900_000);
