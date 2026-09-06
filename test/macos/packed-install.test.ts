import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { registerAgentPreviewJourney } from "../journeys/agent-preview.js";
import { registerOutpaintJourney } from "../journeys/outpaint.js";
import { registerColdOutpaintJourney } from "../journeys/outpaint-cold.js";

const execute = promisify(execFile);

let scratch = "";
let prefix: string;
let library: string;
let binary: string;
let env: NodeJS.ProcessEnv;
let daemonPid: number | undefined;
const run = async (args: string[]) =>
  JSON.parse((await execute(binary, args, { cwd: scratch, env })).stdout);

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "photoctl-install-"));
  prefix = join(scratch, "prefix");
  library = join(scratch, "library");
  env = {
    ...process.env,
    PHOTOCTL_LIBRARY: library,
    PHOTOCTL_CACHE: join(scratch, "cache"),
  };
  delete env.PHOTOCTL_DAEMON_ENTRY;
  delete env.PHOTOCTL_MAC_HELPER_PATH;
  delete env.PHOTOCTL_NO_DAEMON;
  delete env.NODE_PATH;
  binary = join(prefix, "bin/photoctl");
  await execute("bun", ["run", "pack", join(scratch, "tarballs")], {
    cwd: resolve("."),
    timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  await execute(resolve("scripts/install-clean.sh"), [prefix, join(scratch, "tarballs")], {
    cwd: scratch,
    timeout: 180_000,
  });
}, 840_000);

afterAll(async () => {
  if (!scratch) return;
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
});

test("packed CLI starts its daemon and finds both packaged decoders outside the checkout", async () => {
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
  await execute(
    resolve("scripts/gold-exam.sh"),
    [source, "--out", delivery, "--source-kind", "fixture"],
    {
      cwd: scratch,
      env: {
        ...env,
        PATH: `${join(prefix, "bin")}:${process.env.PATH}`,
        PHOTOCTL_VOLUME_MAP: `${scratch}=fixture-volume:online`,
      },
      timeout: 600_000,
    },
  );
  const gold = JSON.parse(await readFile(join(delivery, "gold-exam-report.json"), "utf8"));
  expect(gold.import.data.imported).toBe(10);
  expect(gold.develop.summary.ok).toBe(3);
  expect(gold.export.summary.ok).toBe(10);
  expect(gold.source_kind).toBe("fixture");
  expect(gold.photographic_acceptance).toBe("not_recorded");
  expect(await readFile(join(delivery, "report.html"), "utf8")).toContain("Fixture evidence");
  await execute("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: delivery });
  expect(
    gold.export.results.every((item: { render_hash: string }) =>
      /^r_[0-9a-f]{64}$/u.test(item.render_hash),
    ),
  ).toBe(true);
}, 900_000);

registerAgentPreviewJourney(
  (args, options = {}) =>
    spawnPhotoctl(args, {
      ...options,
      cliPath: binary,
      cwd: scratch,
      env: { ...options.env, PHOTOCTL_NO_DAEMON: "1" },
    }),
  "packed CLI preserves the complete fake-generation and preview journey",
);

registerOutpaintJourney(
  (args, options = {}) =>
    spawnPhotoctl(args, {
      ...options,
      cliPath: binary,
      cwd: scratch,
      env: { ...options.env, PHOTOCTL_NO_DAEMON: "1" },
    }),
  "packed CLI preserves outpaint pixels through the complete keyless lifecycle",
);

registerColdOutpaintJourney((args, options = {}) =>
  spawnPhotoctl(args, {
    ...options,
    cliPath: binary,
    cwd: scratch,
    env: { ...options.env, PHOTOCTL_NO_DAEMON: "1" },
  }),
);
