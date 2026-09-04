import type { LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type Envelope } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { batchEnvelope, resolveBatchInputs, type BatchFailure } from "../batch.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";

interface TagResult {
  id: string;
  ok: true;
  tag: string;
  action: "added" | "removed";
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
    const resolved = await resolveBatchInputs(handle, parsed.positionals);
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
    const results = resolved.map<TagResult | BatchFailure>((item) =>
      item.ok ? { id: item.id, ok: true, tag, action } : item,
    );
    return batchEnvelope(results);
  } finally {
    await lease.release();
  }
}
