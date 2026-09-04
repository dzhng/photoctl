import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const probeOptions = parseArgs(process.argv.slice(2));
try {
  await runProbe(probeOptions);
} catch (error) {
  await writeUnsettledEvidence(probeOptions, error);
  throw error;
}

async function runProbe(options) {
  const temporary = await mkdtemp(join(tmpdir(), "photoctl-toast-probe-"));
  let database;
  try {
    database = await PGlite.create({
      dataDir: temporary,
      extensions: { vector },
      startParams: PGlite.defaultStartParams.filter((argument) => argument !== "-F"),
    });
    await database.exec("SET synchronous_commit = on; CREATE EXTENSION IF NOT EXISTS vector");
    await database.exec(
      "CREATE TABLE toast_probe (id integer PRIMARY KEY, vec halfvec(3072) NOT NULL)",
    );
    const extension = await database.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );

    const updates = await runCycles(database, options.rows, options.cycles);
    const cycleMs = updates.cycleMs;
    let status = updates.status;
    let failure = updates.failure;

    let verifiedRows = 0;
    if (status !== "reproduced") {
      try {
        const verified = await database.query(
          `SELECT count(*)::integer AS count
         FROM toast_probe
         WHERE vec = $1::halfvec AND vector_dims(vec) = 3072`,
          [vectorValue(cycleMs.length - 1)],
        );
        verifiedRows = Number(verified.rows[0]?.count ?? 0);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        if (/missing chunk number/i.test(failure)) status = "reproduced";
        else throw error;
      }
    }
    if (status === "not_reproduced" && verifiedRows !== options.rows) {
      status = "verification_failed";
      failure = `Expected ${options.rows} final vectors, verified ${verifiedRows}`;
    }
    const writeStrategy =
      status === "reproduced" ? "delete_insert" : status === "not_reproduced" ? "upsert" : null;
    const result = {
      gate: "G5",
      status,
      rows: options.rows,
      cycles: options.cycles,
      completedCycles: cycleMs.length,
      dimensions: 3_072,
      vectorPattern: "lcg-per-dimension-per-cycle",
      vectorExtension: extension.rows[0]?.extversion ?? null,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      writeStrategy,
      verifiedRows,
      cycleMs,
      failure,
    };
    await mkdir(dirname(options.evidence), { recursive: true });
    await writeFile(
      options.evidence,
      [
        status === "reproduced"
          ? "PASS (TOAST reproduced)"
          : status === "not_reproduced"
            ? "PASS (TOAST not reproduced)"
            : "FAIL (verification incomplete)",
        `status=${status}`,
        `rows=${options.rows}`,
        `cycles=${options.cycles}`,
        `completed_cycles=${cycleMs.length}`,
        "dimensions=3072",
        `vector_pattern=${result.vectorPattern}`,
        `vector_extension=${result.vectorExtension ?? "unknown"}`,
        `runtime=${process.version} ${process.platform}-${process.arch}`,
        `write_strategy=${writeStrategy ?? "unsettled"}`,
        `verified_rows=${verifiedRows}`,
        `cycle_ms=${cycleMs.join(",")}`,
        `failure=${failure ?? "none"}`,
        "",
      ].join("\n"),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (status === "verification_failed") process.exitCode = 1;
  } finally {
    await database?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

async function writeUnsettledEvidence(options, error) {
  const failure = (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 500);
  await mkdir(dirname(options.evidence), { recursive: true });
  await writeFile(
    options.evidence,
    [
      "FAIL (probe unsettled)",
      "status=unsettled",
      `rows=${options.rows}`,
      `cycles=${options.cycles}`,
      "dimensions=3072",
      "write_strategy=unsettled",
      `failure=${failure || "unknown"}`,
      "",
    ].join("\n"),
  );
}

function parseArgs(args) {
  let rows = 5_000;
  let cycles = 20;
  let evidence = resolve("specs/photoctl/assets/gates/G5-halfvec.txt");
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (value === undefined)
      throw new Error("usage: probe:toast [--rows N --cycles N --evidence PATH]");
    if (name === "--evidence") evidence = resolve(value);
    else if (name === "--rows") rows = positiveInteger(value, name);
    else if (name === "--cycles") cycles = positiveInteger(value, name);
    else throw new Error("usage: probe:toast [--rows N --cycles N --evidence PATH]");
  }
  return { rows, cycles, evidence };
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error(`${name} must be a positive integer`);
  return number;
}

function vectorValue(cycle) {
  let state = (cycle + 1) * 2_654_435_761;
  const values = [];
  for (let dimension = 0; dimension < 3_072; dimension += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    values.push(((state / 0xffff_ffff) * 2 - 1).toFixed(6));
  }
  return `[${values.join(",")}]`;
}

async function runCycles(db, rows, cycles) {
  const cycleMs = [];

  async function run(cycle) {
    if (cycle === cycles) return { status: "not_reproduced", failure: null, cycleMs };
    const started = performance.now();
    try {
      await db.query(
        `INSERT INTO toast_probe (id, vec)
         SELECT id, $2::halfvec
         FROM generate_series(1, $1::integer) AS id
         ON CONFLICT (id) DO UPDATE SET vec = EXCLUDED.vec`,
        [rows, vectorValue(cycle)],
      );
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      if (/missing chunk number/i.test(failure)) {
        return { status: "reproduced", failure, cycleMs };
      }
      throw error;
    }
    cycleMs.push(Math.round(performance.now() - started));
    return await run(cycle + 1);
  }

  return await run(0);
}
