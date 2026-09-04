import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { envelopeExamples } from "./envelopes.js";
import { renderEnvelopeReport } from "./report.js";
import { renderRaceReport, type RaceEvidence } from "./race.js";
import { inspectLibrary, renderLibraryReport } from "./library.js";
import { homedir } from "node:os";

export async function runWorkbench(
  args: string[],
  cwd: string,
  env: { PHOTOCTL_LIBRARY?: string } = process.env,
): Promise<string> {
  const [command, ...rest] = args;
  if (!command || rest.length > 0 || !["envelope", "race", "library"].includes(command))
    throw new Error("usage: wb envelope|race|library");

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
