#!/usr/bin/env node
import { execute } from "@photoctl/commands";
import { exitCodeFor } from "@photoctl/protocol";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const noDaemon = args.includes("--no-daemon");
if (noDaemon) args.splice(args.indexOf("--no-daemon"), 1);
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
const verb = args[0] === "--version" || args[0] === "-V" ? "version" : (args.shift() ?? "");
const execution = await execute(
  {
    verb,
    args,
    cwd: process.cwd(),
    env: {
      noDaemon: noDaemon || process.env.PHOTOCTL_NO_DAEMON === "1",
      libraryPath: process.env.PHOTOCTL_LIBRARY,
      cacheRoot: process.env.PHOTOCTL_CACHE,
      lockBudgetMs: process.env.PHOTOCTL_LOCK_BUDGET_MS,
      pollCeilingMs: process.env.PHOTOCTL_POLL_CEILING_MS,
      volumeMap: process.env.PHOTOCTL_VOLUME_MAP,
      macHelperPath: process.env.PHOTOCTL_MAC_HELPER_PATH,
    },
  },
  { version },
);
for (const event of execution.events) process.stderr.write(`${JSON.stringify(event)}\n`);
const { envelope } = execution;
process.stdout.write(`${JSON.stringify(envelope)}\n`);
process.exitCode = envelope.ok ? 0 : exitCodeFor(envelope.code);
