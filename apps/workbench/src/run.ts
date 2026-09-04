import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { envelopeExamples } from "./envelopes.js";
import { renderEnvelopeReport } from "./report.js";
import { renderRaceReport, type RaceEvidence } from "./race.js";
import { inspectLibrary, renderLibraryReport } from "./library.js";
import { homedir } from "node:os";
import { buildOracleReport } from "./oracle.js";

export async function runWorkbench(
  args: string[],
  cwd: string,
  env: { PHOTOCTL_LIBRARY?: string } = process.env,
): Promise<string> {
  const [command, ...rest] = args;
  if (!command || !["envelope", "race", "library", "oracle"].includes(command))
    throw new Error("usage: wb envelope|race|library|oracle <photo-id>");
  if (command === "oracle") {
    if (rest.length !== 1) throw new Error("usage: wb oracle <photo-id>");
    return await buildOracleReport(rest[0], cwd);
  }
  if (rest.length > 0) throw new Error("usage: wb envelope|race|library|oracle <photo-id>");

  const outputDirectory = join(cwd, "out", "wb");
  await mkdir(outputDirectory, { recursive: true });
  const output = join(outputDirectory, `${command}.html`);
  let html: string;
  if (command === "envelope") html = renderEnvelopeReport(envelopeExamples);
  else if (command === "race") {
    html = renderRaceReport(
      JSON.parse(await readFile(join(outputDirectory, "race.json"), "utf8")) as RaceEvidence,
    );
  } else {
    const library = env.PHOTOCTL_LIBRARY
      ? resolve(cwd, env.PHOTOCTL_LIBRARY)
      : join(homedir(), "Pictures", "photoctl");
    html = renderLibraryReport(await inspectLibrary(library));
  }
  await writeFile(output, html, "utf8");
  return output;
}
