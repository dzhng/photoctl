import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import {
  markupItemInputSchema,
  type Envelope,
  type MarkupData,
  type MarkupDocument,
  type MarkupItemInput,
  PhotoctlError,
} from "@photoctl/protocol";
import {
  loadActiveDocument,
  readActiveDevelopState,
  readMarkupDocument,
  replaceMarkupDocument,
  RevisionConflictError,
} from "@photoctl/render";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";

type MarkupAction = "list" | "add" | "update" | "remove" | "clear";

export async function markupCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseMarkupArgs(args);
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const id = await resolvePhotoId(lease.handle, parsed.photo);
    const photo = await loadPhoto(lease.handle, id);
    await readActiveDevelopState(lease.handle, { photoId: id, orientation: photo.orientation });
    const active = await loadActiveDocument(lease.handle, id);
    if (!active) throw new Error("The active photo document is missing");
    const current = await readMarkupDocument(lease.handle, id);
    if (parsed.action === "list") return success(id, active, current, null);
    const next = mutate(current, parsed);
    if (isDeepStrictEqual(next, current)) return success(id, active, current, null);
    try {
      const committed = await replaceMarkupDocument(lease.handle, id, active.revisionId, next);
      return {
        schema: 1,
        ok: true,
        data: {
          id,
          revision_id: committed.revisionId,
          render_hash: committed.renderHash,
          node: committed.nodeId,
          changed: parsed.action,
          items: next,
        } satisfies MarkupData,
        warnings: [],
      };
    } catch (error) {
      if (error instanceof RevisionConflictError)
        throw new PhotoctlError("library_locked", error.message, {
          id,
          reason: "revision_conflict",
        });
      throw error;
    }
  } finally {
    await lease.release();
  }
}

function success(
  id: string,
  active: NonNullable<Awaited<ReturnType<typeof loadActiveDocument>>>,
  items: MarkupDocument,
  changed: null,
): Envelope {
  return {
    schema: 1,
    ok: true,
    data: {
      id,
      revision_id: active.revisionId,
      render_hash: active.renderHash,
      node: active.roots.output as `node_${string}`,
      changed,
      items,
    } satisfies MarkupData,
    warnings: [],
  };
}

type Parsed =
  | { action: "list"; photo: string }
  | { action: "clear"; photo: string }
  | { action: "add"; photo: string; item: MarkupItemInput }
  | { action: "update"; photo: string; itemId: string; item: MarkupItemInput }
  | { action: "remove"; photo: string; itemId: string };

function parseMarkupArgs(args: string[]): Parsed {
  const action = args[0] as MarkupAction | undefined;
  const photo = args[1];
  if (!action || !["list", "add", "update", "remove", "clear"].includes(action) || !photo)
    throw new PhotoctlError(
      "usage",
      "markup requires list|add|update|remove|clear and one photo ID",
    );
  if (action === "list" && args.length === 2) return { action, photo };
  if (action === "clear" && args.length === 2) return { action, photo };
  if (action === "remove" && args.length === 3) return { action, photo, itemId: args[2]! };
  if (action === "add" && args.length === 4 && args[2] === "--json")
    return { action, photo, item: parseItem(args[3]!) };
  if (action === "update" && args.length === 5 && args[3] === "--json")
    return { action, photo, itemId: args[2]!, item: parseItem(args[4]!) };
  throw new PhotoctlError("usage", `Invalid markup ${action} arguments`);
}

function parseItem(json: string): MarkupItemInput {
  try {
    return markupItemInputSchema.parse(JSON.parse(json));
  } catch (error) {
    throw new PhotoctlError("usage", "--json must contain one valid markup primitive", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function mutate(
  current: MarkupDocument,
  parsed: Exclude<Parsed, { action: "list" }>,
): MarkupDocument {
  if (parsed.action === "clear") return [];
  if (parsed.action === "add") return [...current, { id: randomUUID(), ...parsed.item }];
  const itemId = resolveItemId(current, parsed.itemId);
  if (parsed.action === "remove") return current.filter(({ id }) => id !== itemId);
  return current.map((item) => (item.id === itemId ? { id: itemId, ...parsed.item } : item));
}

function resolveItemId(document: MarkupDocument, input: string): string {
  if (!/^[0-9a-f-]{1,36}$/i.test(input))
    throw new PhotoctlError("usage", `Invalid markup item ID or prefix: ${input}`);
  const matches = document.filter(({ id }) => id.startsWith(input.toLowerCase()));
  if (matches.length === 0)
    throw new PhotoctlError("not_found", `Markup item not found: ${input}`, { id: input });
  if (matches.length > 1)
    throw new PhotoctlError("not_found", `Markup item ID prefix is ambiguous: ${input}`, {
      id: input,
      reason: "ambiguous",
    });
  return matches[0]!.id;
}
