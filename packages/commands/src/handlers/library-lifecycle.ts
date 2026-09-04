import { createBackup, restoreLibrary, type LibraryHandle } from "@photoctl/library";
import {
  PhotoctlError,
  type BackupData,
  type Envelope,
  type MigrateData,
  type RestoreData,
} from "@photoctl/protocol";
import { resolve } from "node:path";
import { libraryPath, openRequestLibrary, parseLockBudget, type RequestEnv } from "../context.js";
import { parseArguments } from "../arguments.js";

export async function backupCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope<BackupData>> {
  noPositionals(parseArguments(args, {}));
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const backup = await createBackup(lease.handle);
    return {
      schema: 1,
      ok: true,
      data: { library: lease.handle.path, path: backup.path, bytes: backup.bytes },
      warnings: backup.exceedsMaxBytes
        ? [
            {
              code: "backup_retention_exceeded",
              message: "The newest backup exceeds the configured 200 MiB retention budget",
            },
          ]
        : [],
    };
  } finally {
    await lease.release();
  }
}

export async function migrateCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope<MigrateData>> {
  noPositionals(parseArguments(args, {}));
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const migration = await lease.handle.migrate();
    return {
      schema: 1,
      ok: true,
      data: {
        library: lease.handle.path,
        from_version: migration.fromVersion,
        to_version: migration.toVersion,
        applied: migration.applied,
      },
      warnings: [],
    };
  } finally {
    await lease.release();
  }
}

export async function restoreCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
): Promise<Envelope<RestoreData>> {
  const parsed = parseArguments(args, { options: ["--from", "--path"] });
  noPositionals(parsed);
  const path = parsed.options.get("--path")
    ? resolve(cwd, parsed.options.get("--path") as string)
    : libraryPath(env, cwd);
  const from = parsed.options.get("--from");
  const restored = await restoreLibrary(path, from ? resolve(cwd, from) : undefined, {
    lockBudgetMs: parseLockBudget(env.lockBudgetMs),
  });
  return {
    schema: 1,
    ok: true,
    data: {
      library: restored.library,
      from: restored.from,
      schema_version: restored.schemaVersion,
    },
    warnings: [],
  };
}

function noPositionals(parsed: { positionals: string[] }): void {
  if (parsed.positionals[0]) {
    throw new PhotoctlError("usage", `Unexpected argument: ${parsed.positionals[0]}`);
  }
}
