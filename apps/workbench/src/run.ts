import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { envelopeExamples } from "./envelopes.js";
import { renderEnvelopeReport } from "./report.js";
import { renderRaceReport, type RaceEvidence } from "./race.js";
import { inspectLibrary, renderLibraryReport } from "./library.js";
import { homedir } from "node:os";
import { buildOracleReport } from "./oracle.js";
import { buildSheetReport } from "./sheet.js";
import { buildGraphReport } from "./graph.js";
import { buildExportReport } from "./export.js";
import { renderPresetsReport } from "./presets.js";

export async function runWorkbench(
  args: string[],
  cwd: string,
  env: { PHOTOCTL_LIBRARY?: string } = process.env,
): Promise<string> {
  const [command, ...rest] = args;
  if (
    !command ||
    !["envelope", "race", "library", "oracle", "sheet", "graph", "export", "presets"].includes(
      command,
    )
  )
    throw new Error("usage: wb envelope|race|library|oracle|sheet|graph|export|presets");
  if (command === "graph") {
    if (rest.length !== 1) throw new Error("usage: wb graph <photo-id>");
    const library = env.PHOTOCTL_LIBRARY
      ? resolve(cwd, env.PHOTOCTL_LIBRARY)
      : join(homedir(), "Pictures", "photoctl");
    const outputDirectory = join(cwd, "out", "wb");
    await mkdir(outputDirectory, { recursive: true });
    const output = join(outputDirectory, "graph.html");
    await writeFile(output, await buildGraphReport(library, rest[0]), "utf8");
    return output;
  }
  if (command === "export") {
    if (rest.length !== 1) throw new Error("usage: wb export <dir>");
    const outputDirectory = join(cwd, "out", "wb");
    await mkdir(outputDirectory, { recursive: true });
    const output = join(outputDirectory, "export.html");
    await writeFile(output, await buildExportReport(resolve(cwd, rest[0])), "utf8");
    return output;
  }
  if (command === "oracle") {
    if (rest.length !== 1) throw new Error("usage: wb oracle <photo-id>");
    return await buildOracleReport(rest[0], cwd);
  }
  if (command === "sheet") {
    const library = rest[0];
    if (!library) throw new Error("usage: wb sheet <library> [--filter expression]");
    let filter: string | null = null;
    if (rest.length > 1) {
      if (rest.length !== 3 || rest[1] !== "--filter") {
        throw new Error("usage: wb sheet <library> [--filter expression]");
      }
      filter = rest[2];
    }
    const outputDirectory = join(cwd, "out", "wb");
    await mkdir(outputDirectory, { recursive: true });
    const output = join(outputDirectory, "sheet.html");
    await writeFile(output, await buildSheetReport(resolve(cwd, library), filter, cwd), "utf8");
    return output;
  }
  if (rest.length > 0)
    throw new Error("usage: wb envelope|race|library|oracle|graph <photo-id>|presets");

  const outputDirectory = join(cwd, "out", "wb");
  await mkdir(outputDirectory, { recursive: true });
  const output = join(outputDirectory, `${command}.html`);
  let html: string;
  if (command === "envelope") html = renderEnvelopeReport(envelopeExamples);
  else if (command === "presets") html = renderPresetsReport();
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
