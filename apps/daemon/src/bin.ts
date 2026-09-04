#!/usr/bin/env node
import { DaemonServer } from "./server.js";

const options = parse(process.argv.slice(2));
const server = new DaemonServer({
  libraryPath: options.get("--library") ?? required("--library"),
  socketPath: options.get("--socket") ?? required("--socket"),
  version: options.get("--version") ?? required("--version"),
  lockFd: Number(process.env.PHOTOCTL_LOCK_FD ?? "3"),
  lockStartedAt: Number(process.env.PHOTOCTL_LOCK_STARTED_AT ?? Date.now()),
});

await server.start();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void server.stop());
}

function parse(args: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1];
    if (!value) required(args[index]);
    parsed.set(args[index], value);
  }
  return parsed;
}

function required(name: string): never {
  throw new Error(`${name} is required`);
}
