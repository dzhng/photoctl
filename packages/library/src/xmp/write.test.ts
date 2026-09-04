import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseXmp } from "./read.js";
import { XmpChangedError } from "./errors.js";
import { InvalidXmpError, mergeXmp, writeXmpSidecar } from "./write.js";

test("parse-merge replaces owned cull fields without changing foreign nodes", () => {
  const foreign = `<crs:ToneCurvePV2012>
        <rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq>
      </crs:ToneCurvePV2012>`;
  const original = `<?xpacket begin="﻿"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      xmp:Rating="1" xmp:Label="Red" crs:Exposure2012="+0.35">
      ${foreign}
      <dc:subject><rdf:Bag><rdf:li>old</rdf:li></rdf:Bag></dc:subject>
      <lr:hierarchicalSubject><rdf:Bag><rdf:li>People|Old</rdf:li></rdf:Bag></lr:hierarchicalSubject>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

  const merged = mergeXmp(original, {
    rating: 5,
    flag: "pick",
    label: "green",
    tags: ["Anna & Ben", `quote "tag"`],
  });

  expect(merged).toContain(foreign);
  expect(merged).toContain(`crs:Exposure2012="+0.35"`);
  expect(merged).toContain(`xmp:Rating="5"`);
  expect(merged).toContain(`xmp:Label="Green"`);
  expect(merged).toContain(`photoctl:flag="pick"`);
  expect(merged).toContain(`<rdf:li>Anna &amp; Ben</rdf:li>`);
  expect(merged).toContain(`<rdf:li>quote &quot;tag&quot;</rdf:li>`);
  expect(merged).not.toContain(`<rdf:li>old</rdf:li>`);
  expect(merged).not.toContain(`People|Old`);
});

test("a new sidecar is readable through the same public metadata contract", () => {
  expect(
    parseXmp(
      mergeXmp(undefined, {
        rating: 4,
        flag: "reject",
        label: null,
        tags: ["family", "People|Anna"],
      }),
    ),
  ).toEqual({ rating: 4, flag: "reject", tags: ["family", "People|Anna"] });
});

test("merge removes owned values from every Description and writes one canonical set", () => {
  const original = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoctl="http://photoctl.dev/xmp/1.0/">
  <rdf:Description xmp:Rating="1"><dc:subject><rdf:Bag><rdf:li>old-one</rdf:li></rdf:Bag></dc:subject><keep:first/></rdf:Description>
  <rdf:Description xmp:Rating="2" photoctl:flag="reject"><xmp:Label>Red</xmp:Label><dc:subject><rdf:Bag><rdf:li>old-two</rdf:li></rdf:Bag></dc:subject><keep:second/></rdf:Description>
</rdf:RDF>`;

  const merged = mergeXmp(original, {
    rating: 5,
    flag: "pick",
    label: "green",
    tags: ["canonical"],
  });

  expect(merged.match(/xmp:Rating="5"/g)).toHaveLength(1);
  expect(merged.match(/xmp:Label="Green"/g)).toHaveLength(1);
  expect(merged.match(/photoctl:flag="pick"/g)).toHaveLength(1);
  expect(merged.match(/<dc:subject\b/g)).toHaveLength(1);
  expect(merged).not.toContain("old-one");
  expect(merged).not.toContain("old-two");
  expect(merged).toContain("<keep:first/>");
  expect(merged).toContain("<keep:second/>");
});

test("merge validates namespace bindings inherited by a Description", () => {
  const original = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="https://foreign.invalid/xmp"><rdf:Description><xmp:Foreign/></rdf:Description></rdf:RDF>`;

  expect(() => mergeXmp(original, { rating: 2, flag: "none", label: null, tags: [] })).toThrowError(
    InvalidXmpError,
  );
});

test("write retries from an external edit observed immediately before publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-race-"));
  const image = join(root, "frame.png");
  const sidecar = join(root, "frame.xmp");
  await writeFile(image, "image");
  await writeFile(
    sidecar,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description><keep:version>initial</keep:version></rdf:Description></rdf:RDF>`,
  );
  let edited = false;
  try {
    await writeXmpSidecar(
      image,
      { rating: 4, flag: "pick", label: null, tags: [] },
      {
        beforeSnapshotCompare: async () => {
          if (edited) return;
          edited = true;
          await writeFile(
            sidecar,
            `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description><keep:version>external</keep:version></rdf:Description></rdf:RDF>`,
          );
        },
      },
    );

    const written = await readFile(sidecar, "utf8");
    expect(edited).toBe(true);
    expect(written).toContain("<keep:version>external</keep:version>");
    expect(written).toContain(`xmp:Rating="4"`);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("write preserves an atomic replacement made after verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-publish-race-"));
  const image = join(root, "frame.png");
  const sidecar = join(root, "frame.xmp");
  const replacement = join(root, "external.xmp");
  await writeFile(image, "image");
  await writeFile(
    sidecar,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description><keep:version>initial</keep:version></rdf:Description></rdf:RDF>`,
  );
  await writeFile(
    replacement,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description><keep:version>external-after-verify</keep:version></rdf:Description></rdf:RDF>`,
  );
  let edited = false;
  try {
    await writeXmpSidecar(
      image,
      { rating: 4, flag: "pick", label: null, tags: [] },
      {
        afterSnapshotCompare: async () => {
          if (edited) return;
          edited = true;
          await rename(replacement, sidecar);
        },
      },
    );

    const written = await readFile(sidecar, "utf8");
    expect(edited).toBe(true);
    expect(written).toContain("<keep:version>external-after-verify</keep:version>");
    expect(written).toContain(`xmp:Rating="4"`);
    expect((await readdir(root)).filter((name) => name.includes(".photoctl-"))).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("write refuses repeated conflicts without replacing the external sidecar", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-xmp-conflict-"));
  const image = join(root, "frame.png");
  const sidecar = join(root, "frame.xmp");
  await writeFile(image, "image");
  await writeFile(
    sidecar,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description><keep:version>initial</keep:version></rdf:Description></rdf:RDF>`,
  );
  try {
    await expect(
      writeXmpSidecar(
        image,
        { rating: 4, flag: "pick", label: null, tags: [] },
        {
          beforeSnapshotCompare: async (attempt) => {
            await writeFile(
              sidecar,
              `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description><keep:version>external-${attempt}</keep:version></rdf:Description></rdf:RDF>`,
            );
          },
        },
      ),
    ).rejects.toThrowError(XmpChangedError);
    expect(await readFile(sidecar, "utf8")).toContain("<keep:version>external-3</keep:version>");
    expect((await readdir(root)).filter((name) => name.includes(".photoctl-"))).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});
