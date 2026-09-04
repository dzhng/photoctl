import { access } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { PhotoctlError } from "@photoctl/protocol";

export type RestorePhase = "prepared" | "live_moved" | "promoted" | "committed";

export interface RestoreJournal {
  schema: 1;
  phase: RestorePhase;
  live: string;
  stage: string;
  rollback: string;
  source: string;
}

export function restoreJournalPath(libraryPath: string): string {
  const live = resolve(libraryPath);
  return join(dirname(live), `.${basename(live)}.photoctl-restore.json`);
}

export async function assertNoRestoreJournal(libraryPath: string): Promise<void> {
  const journal = restoreJournalPath(libraryPath);
  try {
    await access(journal);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  const live = resolve(libraryPath);
  throw new PhotoctlError(
    "catalog_unreadable",
    `An interrupted restore must be recovered: ${live}`,
    {
      path: live,
      journal,
      hint: `photoctl restore --path ${live}`,
    },
  );
}

export function validateRestoreJournal(value: unknown, libraryPath: string): RestoreJournal {
  const live = resolve(libraryPath);
  const parent = dirname(live);
  const prefix = `.${basename(live)}.`;
  if (
    typeof value !== "object" ||
    value === null ||
    !("schema" in value) ||
    value.schema !== 1 ||
    !("phase" in value) ||
    !["prepared", "live_moved", "promoted", "committed"].includes(String(value.phase)) ||
    !("live" in value) ||
    value.live !== live ||
    !("stage" in value) ||
    typeof value.stage !== "string" ||
    dirname(value.stage) !== parent ||
    !basename(value.stage).startsWith(`${prefix}restore-`) ||
    !("rollback" in value) ||
    typeof value.rollback !== "string" ||
    dirname(value.rollback) !== parent ||
    !basename(value.rollback).startsWith(`${prefix}rollback-`) ||
    !("source" in value) ||
    typeof value.source !== "string"
  ) {
    throw new PhotoctlError(
      "catalog_unreadable",
      `Invalid restore journal: ${restoreJournalPath(live)}`,
      {
        path: live,
        journal: restoreJournalPath(live),
        hint: `Inspect the restore journal before retrying photoctl restore --path ${live}`,
      },
    );
  }
  const stageToken = basename(value.stage).slice(`${prefix}restore-`.length);
  const rollbackToken = basename(value.rollback).slice(`${prefix}rollback-`.length);
  if (
    stageToken !== rollbackToken ||
    !UUID_V4.test(stageToken) ||
    resolve(value.source) !== value.source
  ) {
    throw new PhotoctlError(
      "catalog_unreadable",
      `Invalid restore journal: ${restoreJournalPath(live)}`,
      {
        path: live,
        journal: restoreJournalPath(live),
        hint: `Inspect the restore journal before retrying photoctl restore --path ${live}`,
      },
    );
  }
  return value as RestoreJournal;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
