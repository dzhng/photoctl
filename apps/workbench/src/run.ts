import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envelopeExamples } from "./envelopes.js";
import { renderEnvelopeReport } from "./report.js";
import { renderRaceReport, type RaceEvidence } from "./race.js";

export async function runWorkbench(args: string[], cwd: string): Promise<string> {
  const [command, ...rest] = args;
  if (!command || rest.length > 0 || !["envelope", "race"].includes(command))
    throw new Error("usage: wb envelope|race");

  const outputDirectory = join(cwd, "out", "wb");
  await mkdir(outputDirectory, { recursive: true });
  const output = join(outputDirectory, `${command}.html`);
  const html =
    command === "envelope"
      ? renderEnvelopeReport(envelopeExamples)
      : renderRaceReport(
          JSON.parse(await readFile(join(outputDirectory, "race.json"), "utf8")) as RaceEvidence,
        );
  await writeFile(output, html, "utf8");
  return output;
}
