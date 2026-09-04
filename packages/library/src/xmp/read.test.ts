import { mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseXmp, readXmpPath } from "./read.js";

test("Classic XMP fields map to cull state and exact-deduped leaf keywords", () => {
  const parsed = parseXmp(`<?xml version="1.0"?>
    <x:xmpmeta xmlns:x="adobe:ns:meta/">
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/"
          xmlns:dc="http://purl.org/dc/elements/1.1/"
          xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
          xmlns:photoctl="http://photoctl.dev/xmp/1.0/"
          xmp:Rating="4" xmp:Label="gReEn" photoctl:flag="pick">
          <dc:subject><rdf:Bag><rdf:li>family</rdf:li><rdf:li>Anna</rdf:li></rdf:Bag></dc:subject>
          <lr:hierarchicalSubject><rdf:Bag><rdf:li>People|Anna</rdf:li><rdf:li>family</rdf:li></rdf:Bag></lr:hierarchicalSubject>
        </rdf:Description>
      </rdf:RDF>
    </x:xmpmeta>`);

  expect(parsed).toEqual({ rating: 4, label: "green", flag: "pick", tags: ["family", "Anna"] });
});

test("an unknown label becomes null and emits the label warning", () => {
  expect(parseXmp(`<xmp:Description xmlns:xmp="x" xmp:Label="Custom"/>`)).toEqual({
    label: null,
    tags: [],
    labelUnknown: "Custom",
  });
});

test("photoctl flag is accepted only from the owned namespace", () => {
  expect(
    parseXmp(
      `<rdf:Description xmlns:rdf="rdf" xmlns:photoctl="https://other.invalid" photoctl:flag="reject"/>`,
    ),
  ).toEqual({ tags: [] });
});

test("path reads never pair old XML with metadata from a replacement file", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-read-race-"));
  const path = join(root, "frame.xmp");
  const replacement = join(root, "replacement.xmp");
  await writeFile(path, `<rdf:Description xmp:Rating="1"/>`);
  await writeFile(replacement, `<rdf:Description xmp:Rating="5"/>`);
  let replaced = false;
  try {
    const read = await readXmpPath(path, {
      afterRead: async () => {
        if (replaced) return;
        replaced = true;
        await rename(replacement, path);
      },
    });
    const replacementMtime = (await stat(path)).mtime;

    expect(replaced).toBe(true);
    expect(read).toMatchObject({ rating: 5 });
    expect(read?.mtime.getTime()).toBe(replacementMtime.getTime());
  } finally {
    await rm(root, { recursive: true });
  }
});
