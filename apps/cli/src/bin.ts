#!/usr/bin/env node
import { dispatch } from "@photoctl/commands";
import { exitCodeFor } from "@photoctl/protocol";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
const verb = args[0] === "--version" || args[0] === "-V" ? "version" : (args.shift() ?? "");
const envelope = await dispatch(
  { verb, args, cwd: process.cwd(), env: { noDaemon: process.env.PHOTOCTL_NO_DAEMON === "1" } },
  { version },
);
process.stdout.write(`${JSON.stringify(envelope)}\n`);
process.exitCode = envelope.ok ? 0 : exitCodeFor(envelope.code);
