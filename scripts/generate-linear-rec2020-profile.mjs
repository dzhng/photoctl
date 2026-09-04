#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, process.argv[2] ?? "packages/render/assets/LinearRec2020-v4.icc");
const prefix = process.env.PHOTOCTL_LCMS_PREFIX ?? "/opt/homebrew";
const temporary = await mkdtemp(join(tmpdir(), "photoctl-icc-"));
try {
  const binary = join(temporary, "generate-profile");
  for (const [command, args] of [
    [
      "cc",
      [
        resolve(import.meta.dirname, "generate-linear-rec2020-profile.c"),
        "-I",
        join(prefix, "include"),
        "-L",
        join(prefix, "lib"),
        "-llcms2",
        "-o",
        binary,
      ],
    ],
    [binary, [output]],
  ]) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  }
  const profile = await readFile(output);
  // ICC header date: 2026-09-05 00:00:00 UTC. Profile IDs hash these header fields as zero.
  [2026, 9, 5, 0, 0, 0].forEach((value, index) => profile.writeUInt16BE(value, 24 + index * 2));
  profile.fill(0, 84, 100);
  const digestInput = Buffer.from(profile);
  digestInput.fill(0, 44, 48);
  digestInput.fill(0, 64, 68);
  createHash("md5").update(digestInput).digest().copy(profile, 84);
  await writeFile(output, profile);
  process.stdout.write(`${createHash("sha256").update(profile).digest("hex")}  ${output}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
