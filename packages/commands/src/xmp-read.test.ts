import { initializeLibrary } from "@photoctl/library";
import type { CommandRequest } from "@photoctl/protocol";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("XMP seeds cull state once, then PGlite edits win on re-import", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-import-"));
  const drive = join(root, "drive");
  const image = join(drive, "frame.png");
  const sidecar = join(drive, "frame.xmp");
  const library = await initializeLibrary(join(root, "library"));
  const request: CommandRequest = {
    verb: "import",
    args: [drive, "--link"],
    cwd: process.cwd(),
    env: {
      noDaemon: true,
      cacheRoot: join(root, "cache"),
      volumeMap: `${drive}=xmp-volume:online`,
    },
  };
  try {
    await mkdir(drive);
    await writeFile(image, png);
    await writeFile(sidecar, xmp("4", "Green", ["Family", "People|Anna"]));
    const first = await dispatch(request, { version: "test", library: library.handle });
    const id = (first as { data: { ids: string[] } }).data.ids[0];
    await library.handle.query("UPDATE photos SET rating = 5 WHERE id = $1", [id]);
    await writeFile(sidecar, xmp("1", "Custom", ["Changed"]));
    const changedMtime = new Date("2026-01-02T03:04:05Z");
    await utimes(sidecar, changedMtime, changedMtime);

    const stale = await dispatch(
      { ...request, verb: "list", args: ["--xmp-stale"] },
      { version: "test", library: library.handle },
    );

    const second = await dispatch(request, { version: "test", library: library.handle });
    const refreshed = await dispatch(
      { ...request, verb: "list", args: ["--xmp-stale"] },
      { version: "test", library: library.handle },
    );

    expect(first).toMatchObject({
      ok: true,
      data: { xmp_read: { sidecars_found: 1, ratings: 1, keywords: 2, labels: 1 } },
    });
    expect(second).toMatchObject({
      ok: true,
      warnings: [{ code: "label_unknown", id }],
    });
    expect(stale).toMatchObject({ ok: true, data: { rows: [{ id }], total: 1 } });
    expect(refreshed).toMatchObject({ ok: true, data: { rows: [], total: 0 } });
    const state = await library.handle.query<{
      rating: number;
      label: string | null;
      tags: string[];
      sidecar_mtime_ms: string;
    }>(
      `SELECT p.rating, p.label,
              array(SELECT tag FROM tags WHERE photo_id = p.id ORDER BY tag) AS tags,
              (extract(epoch FROM xs.sidecar_mtime) * 1000)::bigint::text AS sidecar_mtime_ms
       FROM photos p JOIN xmp_state xs ON xs.photo_id = p.id WHERE p.id = $1`,
      [id],
    );
    expect(state.rows).toEqual([
      {
        rating: 5,
        label: "green",
        tags: ["Anna", "Family"],
        sidecar_mtime_ms: String(changedMtime.getTime()),
      },
    ]);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

function xmp(rating: string, label: string, tags: string[]): string {
  const items = tags.map((tag) => `<rdf:li>${tag}</rdf:li>`).join("");
  return `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
      xmp:Rating="${rating}" xmp:Label="${label}">
      <lr:hierarchicalSubject><rdf:Bag>${items}</rdf:Bag></lr:hierarchicalSubject>
    </rdf:Description></rdf:RDF>`;
}
