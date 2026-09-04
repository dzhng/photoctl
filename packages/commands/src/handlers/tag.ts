import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type Envelope, type ErrorCode } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";

interface TagResult {
  id: string;
  ok: true;
  tag: string;
  action: "added" | "removed";
}

interface TagFailure {
  id: string;
  ok: false;
  code: ErrorCode;
  [key: string]: unknown;
}

export async function tagCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { options: ["--add", "--remove"] });
  if (parsed.positionals.length === 0) {
    throw new PhotoctlError("usage", "tag requires at least one photo ID");
  }
  const add = parsed.options.get("--add");
  const remove = parsed.options.get("--remove");
  if (Number(add !== undefined) + Number(remove !== undefined) !== 1) {
    throw new PhotoctlError("usage", "tag requires exactly one of --add or --remove");
  }
  const tag = (add ?? remove)?.trim();
  if (!tag) throw new PhotoctlError("usage", "tag value must not be empty");
  const action = add === undefined ? "removed" : "added";

  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  try {
    const resolved = await resolveInputs(handle, parsed.positionals);
    await handle.query("BEGIN");
    try {
      const ids = resolved.filter((item) => item.ok).map((item) => item.id);
      if (ids.length > 0) {
        if (action === "added") {
          await handle.query(
            `INSERT INTO tags (photo_id, tag)
             SELECT photo_id, $2 FROM unnest($1::uuid[]) AS input(photo_id)
             ON CONFLICT DO NOTHING`,
            [ids, tag],
          );
        } else {
          await handle.query("DELETE FROM tags WHERE photo_id = ANY($1::uuid[]) AND tag = $2", [
            ids,
            tag,
          ]);
        }
      }
      await handle.query("COMMIT");
    } catch (error) {
      await handle.query("ROLLBACK");
      throw error;
    }
    const results = resolved.map<TagResult | TagFailure>((item) =>
      item.ok ? { id: item.id, ok: true, tag, action } : item,
    );
    const failures = results.filter((item): item is TagFailure => !item.ok);
    if (failures.length > 0) {
      return {
        schema: 1,
        ok: false,
        code: failures.length === results.length ? commonFailureCode(failures) : "partial",
        summary: { ok: results.length - failures.length, failed: failures.length },
        results,
        warnings: [],
      };
    }
    return {
      schema: 1,
      ok: true,
      summary: { ok: results.length, failed: 0 },
      results,
      warnings: [],
    };
  } finally {
    await lease.release();
  }
}

async function resolveInputs(
  handle: LibraryHandle,
  inputs: string[],
): Promise<Array<{ id: string; ok: true } | TagFailure>> {
  return await Promise.all(
    inputs.map(async (input) => {
      try {
        return { id: await resolvePhotoId(handle, input), ok: true } as const;
      } catch (error) {
        if (!(error instanceof PhotoctlError)) throw error;
        return { id: input, ok: false, code: error.code, ...errorData(error.data) } as const;
      }
    }),
  );
}

function commonFailureCode(failures: TagFailure[]): ErrorCode {
  const codes = new Set(failures.map((failure) => failure.code));
  return codes.size === 1 ? failures[0].code : "partial";
}

function errorData(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}
