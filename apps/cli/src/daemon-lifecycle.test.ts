import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, createServer, type Socket } from "node:net";
import { afterEach, expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { daemonSocketPath, ensureDaemon } from "@photoctl/commands";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("init leaves its new library served by the daemon", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-init-daemon-"));
  directories.push(parent);
  const library = join(parent, "library");

  const initialized = await spawnPhotoctl(["init", "--path", library], {
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });

  expect(initialized.code).toBe(0);
  expect(initialized.events).toContainEqual(
    expect.objectContaining({ event: "daemon", action: "spawned", schema: 1 }),
  );
  expect(
    (
      await spawnPhotoctl(["daemon", "stop"], {
        libraryDir: library,
        env: { PHOTOCTL_NO_DAEMON: "0" },
      })
    ).code,
  ).toBe(0);
}, 30_000);

test("init remains successful when its optional daemon start fails", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-init-without-daemon-"));
  directories.push(parent);
  const library = join(parent, "library");

  const initialized = await spawnPhotoctl(["init", "--path", library], {
    env: { PHOTOCTL_NO_DAEMON: "0", PHOTOCTL_DAEMON_ENTRY: join(parent, "missing-daemon.js") },
  });

  expect(initialized.code).toBe(0);
  expect(initialized.json).toMatchObject({
    schema: 1,
    ok: true,
    warnings: [{ code: "daemon_unavailable" }],
  });
  await expect(stat(join(library, "PG_VERSION"))).resolves.toBeDefined();
}, 30_000);

test("the first ordinary command starts one daemon and status reports it", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-start-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const diagnosed = await spawnPhotoctl(["doctor"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });
  const status = await spawnPhotoctl(["daemon", "status"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });

  expect(diagnosed.code).toBe(0);
  expect(diagnosed.events).toContainEqual(
    expect.objectContaining({ event: "daemon", action: "spawned", schema: 1 }),
  );
  expect(status.code).toBe(0);
  expect(status.json).toMatchObject({
    schema: 1,
    ok: true,
    data: {
      pid: expect.any(Number),
      socket: expect.stringMatching(/photoctl-[0-9a-f]{8}\.sock$/),
      uptime_s: expect.any(Number),
      queue: 0,
      version: "0.1.0",
    },
    warnings: [],
  });
  const socketPath = (status.json as { data: { socket: string } }).data.socket;
  expect((await stat(socketPath)).mode & 0o777).toBe(0o600);

  const repeatedStart = await spawnPhotoctl(["daemon", "start"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });
  expect(repeatedStart.json).toMatchObject({
    schema: 1,
    ok: true,
    data: { uptime_s: expect.any(Number) },
  });
  expect((repeatedStart.json as { data: { uptime_s: number } }).data.uptime_s).toBeGreaterThan(0);

  const idleClients = await Promise.all(
    Array.from({ length: 9 }, () => connectIdleClient(socketPath)),
  );
  const withIdleClients = await spawnPhotoctl(["doctor"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });
  idleClients.forEach((socket) => socket.destroy());
  expect(withIdleClients.code).toBe(0);

  expect(
    (
      await spawnPhotoctl(["daemon", "stop"], {
        libraryDir: library,
        env: { PHOTOCTL_NO_DAEMON: "0" },
      })
    ).code,
  ).toBe(0);
}, 30_000);

test("an idle daemon accepts an uncontended request with a zero lock budget", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-zero-budget-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const env = { PHOTOCTL_NO_DAEMON: "0" };
  expect((await spawnPhotoctl(["daemon", "start"], { libraryDir: library, env })).code).toBe(0);

  const diagnosed = await spawnPhotoctl(["doctor"], {
    libraryDir: library,
    env: { ...env, PHOTOCTL_LOCK_BUDGET_MS: "0" },
  });

  expect(diagnosed.code).toBe(0);
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
}, 30_000);

async function connectIdleClient(path: string): Promise<Socket> {
  return await new Promise((resolveSocket, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => resolveSocket(socket));
    socket.once("error", reject);
  });
}

test("no-daemon stops a live daemon before opening the library in-process", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-no-daemon-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const started = await spawnPhotoctl(["daemon", "start"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });
  const pid = (started.json as { data: { pid: number } }).data.pid;

  const diagnosed = await spawnPhotoctl(["doctor", "--no-daemon"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });
  const status = await spawnPhotoctl(["daemon", "status"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });

  expect(diagnosed.code).toBe(0);
  expect(diagnosed.events).toEqual([]);
  expect(status.code).toBe(69);
  expect(() => process.kill(pid, 0)).toThrow();
}, 30_000);

test("daemon stop does not report success while a live holder is unresponsive", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-unresponsive-"));
  directories.push(parent);
  const library = join(parent, "library");
  const env = { PHOTOCTL_NO_DAEMON: "0" };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const started = await spawnPhotoctl(["daemon", "start"], { libraryDir: library, env });
  const pid = (started.json as { data: { pid: number } }).data.pid;

  process.kill(pid, "SIGSTOP");
  try {
    const stopped = await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
    expect(stopped.code).toBe(69);
    expect(stopped.json).toMatchObject({ ok: false, code: "daemon_unavailable" });
  } finally {
    process.kill(pid, "SIGCONT");
    await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
  }
}, 30_000);

test("a command respawns the daemon after an unclean kill", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-kill-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const env = { PHOTOCTL_NO_DAEMON: "0", PHOTOCTL_POLL_CEILING_MS: "10" };
  const started = await spawnPhotoctl(["daemon", "start"], { libraryDir: library, env });
  const firstPid = (started.json as { data: { pid: number } }).data.pid;
  process.kill(firstPid, "SIGKILL");
  await waitForProcessExit(firstPid);

  const diagnosed = await spawnPhotoctl(["doctor"], { libraryDir: library, env });
  const event = diagnosed.events.find(
    (candidate) => candidate.event === "daemon" && candidate.action === "spawned",
  );

  expect(diagnosed.code).toBe(0);
  expect(event).toEqual(expect.objectContaining({ pid: expect.any(Number) }));
  expect(event && "pid" in event ? event.pid : firstPid).not.toBe(firstPid);
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
}, 30_000);

test("a stale socket payload owned by a dead pid is replaced once", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-stale-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const socket = daemonSocketPath(library, "0.1.0");
  await writeFile(socket, "stale");
  await writeFile(
    join(library, ".photoctl-open.lock"),
    JSON.stringify({ pid: 2_147_483_647, socket, startedAt: Date.now() }),
  );

  const diagnosed = await spawnPhotoctl(["doctor"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0", PHOTOCTL_POLL_CEILING_MS: "10" },
  });

  expect(diagnosed.code).toBe(0);
  expect(diagnosed.events).toContainEqual(
    expect.objectContaining({ event: "daemon", action: "spawned", socket }),
  );
  await spawnPhotoctl(["daemon", "stop"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });
}, 30_000);

test("a dead socket with a live-looking pid reports the replacement daemon", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-dead-socket-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const socket = daemonSocketPath(library, "0.1.0");
  await writeFile(
    join(library, ".photoctl-open.lock"),
    JSON.stringify({ pid: process.pid, socket, startedAt: Date.now() }),
  );

  const diagnosed = await spawnPhotoctl(["doctor"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0", PHOTOCTL_POLL_CEILING_MS: "10" },
  });
  const event = diagnosed.events.find((candidate) => candidate.event === "daemon");

  expect(diagnosed.code).toBe(0);
  expect(event).toEqual(expect.objectContaining({ action: "spawned", pid: expect.any(Number) }));
  expect(event && "pid" in event ? event.pid : process.pid).not.toBe(process.pid);
  await spawnPhotoctl(["daemon", "stop"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });
}, 30_000);

test("a live-looking impostor socket with a free lock is replaced", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-impostor-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const socket = daemonSocketPath(library, "0.1.0");
  const impostor = createServer((client) => client.destroy());
  await new Promise<void>((resolveListen, reject) => {
    impostor.once("error", reject);
    impostor.listen(socket, resolveListen);
  });
  await writeFile(
    join(library, ".photoctl-open.lock"),
    JSON.stringify({ pid: process.pid, socket, startedAt: Date.now() }),
  );

  try {
    const diagnosed = await spawnPhotoctl(["doctor"], {
      libraryDir: library,
      env: { PHOTOCTL_NO_DAEMON: "0", PHOTOCTL_POLL_CEILING_MS: "10" },
    });
    const event = diagnosed.events.find((candidate) => candidate.event === "daemon");
    expect(diagnosed.code).toBe(0);
    expect(event).toEqual(expect.objectContaining({ action: "spawned", pid: expect.any(Number) }));
    expect(event && "pid" in event ? event.pid : process.pid).not.toBe(process.pid);
  } finally {
    await new Promise<void>((resolveClose) => impostor.close(() => resolveClose()));
    await spawnPhotoctl(["daemon", "stop"], {
      libraryDir: library,
      env: { PHOTOCTL_NO_DAEMON: "0" },
    });
  }
}, 30_000);

test("a live daemon from another photoctl version stops before replacement", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-version-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const foreign = await ensureDaemon(library, "0.0.0-foreign", {
    lockBudgetMs: 5_000,
    pollCeilingMs: 10,
  });

  const diagnosed = await spawnPhotoctl(["doctor"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0", PHOTOCTL_POLL_CEILING_MS: "10" },
  });
  const replacement = diagnosed.events.find(
    (candidate) => candidate.event === "daemon" && candidate.action === "spawned",
  );

  expect(diagnosed.code).toBe(0);
  expect(replacement).toEqual(
    expect.objectContaining({ version: "0.1.0", pid: expect.any(Number) }),
  );
  expect(replacement && "pid" in replacement ? replacement.pid : foreign.endpoint.pid).not.toBe(
    foreign.endpoint.pid,
  );
  expect(() => process.kill(foreign.endpoint.pid, 0)).toThrow();
  await spawnPhotoctl(["daemon", "stop"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });
}, 30_000);

test("removing the library mount causes a graceful daemon stop", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-unmount-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const started = await spawnPhotoctl(["daemon", "start"], {
    libraryDir: library,
    env: { PHOTOCTL_NO_DAEMON: "0" },
  });
  const pid = (started.json as { data: { pid: number } }).data.pid;

  await rm(library, { recursive: true });

  await expect(waitForProcessExit(pid)).resolves.toBeUndefined();
}, 30_000);

test("the imported-image journey runs through one persistent daemon handle", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-journey-"));
  directories.push(parent);
  const library = join(parent, "library");
  const output = join(parent, "output");
  const fixture = join(process.cwd(), "fixtures", "a7c2.ARW");
  const env = {
    PHOTOCTL_NO_DAEMON: "0",
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${process.cwd()}=fixture-volume:online`,
  };
  expect(
    (
      await spawnPhotoctl(["init", "--path", library], {
        env: { PHOTOCTL_NO_DAEMON: "1" },
      })
    ).code,
  ).toBe(0);

  const imported = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];
  const shown = await spawnPhotoctl(["show", id], { libraryDir: library, env });
  const exported = await spawnPhotoctl(["export", id, "--to", output], {
    libraryDir: library,
    env,
  });
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });

  expect(imported.code).toBe(0);
  expect(shown.code).toBe(0);
  expect(exported.code).toBe(0);
  const file = (
    exported.json as { results: Array<{ ok: true; file: string } | { ok: false }> }
  ).results.find((result) => result.ok)?.file;
  expect(file).toBeDefined();
  await expect(stat(file ?? "")).resolves.toMatchObject({ size: expect.any(Number) });
}, 30_000);

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`process ${pid} did not exit`);
}
