import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "@photoctl/library";
import { seedPhotoRows, spawnPhotoctl } from "@photoctl/test-harness";
import { runWorkbench } from "../apps/workbench/dist/run.js";

const { clients, rows } = parseArgs(process.argv.slice(2));
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "photoctl-race-probe-"));
const library = join(temporary, "library");
const env = {
  PHOTOCTL_NO_DAEMON: "0",
  PHOTOCTL_LOCK_BUDGET_MS: "30000",
  PHOTOCTL_POLL_CEILING_MS: "100",
};

try {
  const initialized = await spawnPhotoctl(["init", "--path", library], {
    env: { PHOTOCTL_NO_DAEMON: "1" },
  });
  if (initialized.code !== 0) throw new Error(`init failed: ${JSON.stringify(initialized.json)}`);
  const [id] = await seedPhotoRows(library, 1);
  const started = await spawnPhotoctl(["daemon", "start"], { libraryDir: library, env });
  if (started.code !== 0) throw new Error(`daemon start failed: ${JSON.stringify(started.json)}`);

  const observed = await Promise.all(
    Array.from({ length: clients }, async (_, client) => {
      const beganAt = performance.now();
      const writes = [];
      for (let row = 0; row < rows; row += 1) {
        const tag = `p${client}-${row}`;
        const result = await spawnPhotoctl(["tag", id, "--add", tag], {
          libraryDir: library,
          env,
        });
        writes.push({ tag, result });
      }
      return { client, elapsedMs: Math.round(performance.now() - beganAt), writes };
    }),
  );
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });

  const successfulTags = observed
    .flatMap((client) => client.writes)
    .filter(({ result }) => result.code === 0)
    .map(({ tag }) => tag)
    .toSorted();
  const failures = observed
    .flatMap((client) => client.writes)
    .filter(({ result }) => result.code !== 0);
  const handle = await openLibrary(library);
  const stored = await handle.query("SELECT tag FROM tags ORDER BY tag");
  await handle.close();
  const storedTags = stored.rows.map(({ tag }) => tag);
  const evidence = {
    clients,
    rowsPerClient: rows,
    expectedRows: clients * rows,
    successfulWrites: successfulTags.length,
    foundRows: storedTags.length,
    failures: Object.fromEntries(
      [
        ...new Set(
          failures.map(({ result }) => (result.json.ok ? "unexpected" : result.json.code)),
        ),
      ].map((code) => [
        code,
        failures.filter(({ result }) => !result.json.ok && result.json.code === code).length,
      ]),
    ),
    clientsObserved: observed.map((client) => ({
      client: client.client,
      ok: client.writes.filter(({ result }) => result.code === 0).length,
      failed: client.writes.filter(({ result }) => result.code !== 0).length,
      elapsedMs: client.elapsedMs,
    })),
  };
  const persistedExactly = JSON.stringify(storedTags) === JSON.stringify(successfulTags);
  const failuresAreLoud = failures.every(
    ({ result }) => result.code === 75 && !result.json.ok && result.json.code === "library_locked",
  );
  const passed = persistedExactly && failuresAreLoud;
  await mkdir(join(root, "out", "wb"), { recursive: true });
  await writeFile(join(root, "out", "wb", "race.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  const report = await runWorkbench(["race"], root);
  await mkdir(join(root, "specs", "photoctl", "assets", "gates"), { recursive: true });
  await writeFile(
    join(root, "specs", "photoctl", "assets", "gates", "G1-concurrency.txt"),
    `${passed ? "PASS" : "FAIL"}\nclients=${clients}\nrows_per_client=${rows}\nattempted=${clients * rows}\naccepted=${successfulTags.length}\npersisted=${storedTags.length}\nfailures=${failures.length}\nfailure_codes=${Object.keys(evidence.failures).join(",") || "none"}\n`,
  );
  process.stdout.write(`${report}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env }).catch(() => undefined);
  await rm(temporary, { recursive: true, force: true });
}

function parseArgs(args) {
  let clientCount = 8;
  let rowCount = 25;
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = Number(args[index + 1]);
    if (!["--clients", "--rows"].includes(name) || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error("usage: probe:race -- --clients N --rows N");
    }
    if (name === "--clients") clientCount = value;
    if (name === "--rows") rowCount = value;
  }
  return { clients: clientCount, rows: rowCount };
}
