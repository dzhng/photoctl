import { randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { InvalidXmpError, XmpChangedError, XmpFilesystemError } from "./errors.js";
import type { CullFlag, CullLabel } from "./read.js";
import { sidecarPathForImage } from "./read.js";
import { publishXmpSnapshot } from "./publish.js";
import { readFileSnapshot } from "./snapshot.js";

export { InvalidXmpError } from "./errors.js";

const PHOTOCTL_NAMESPACE = "http://photoctl.dev/xmp/1.0/";
const MAX_WRITE_ATTEMPTS = 3;
const NAMESPACES = new Map([
  ["rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
  ["xmp", "http://ns.adobe.com/xap/1.0/"],
  ["dc", "http://purl.org/dc/elements/1.1/"],
  ["photoctl", PHOTOCTL_NAMESPACE],
]);
const OWNED_ATTRIBUTES = ["xmp:Rating", "xmp:Label", "photoctl:flag"];
const OWNED_ELEMENTS = new Set([
  "xmp:Rating",
  "xmp:Label",
  "photoctl:flag",
  "dc:subject",
  "lr:hierarchicalSubject",
]);
const OWNED_ELEMENT_NAMESPACES = new Map([
  ["xmp", "http://ns.adobe.com/xap/1.0/"],
  ["dc", "http://purl.org/dc/elements/1.1/"],
  ["lr", "http://ns.adobe.com/lightroom/1.0/"],
  ["photoctl", PHOTOCTL_NAMESPACE],
]);

export interface XmpCullMetadata {
  rating: number;
  flag: CullFlag;
  label: CullLabel | null;
  tags: string[];
}

export interface WriteXmpHooks {
  beforeSnapshotCompare?: (attempt: number) => Promise<void>;
  afterSnapshotCompare?: (attempt: number) => Promise<void>;
}

export async function writeXmpSidecar(
  imagePath: string,
  metadata: XmpCullMetadata,
  hooks: WriteXmpHooks = {},
): Promise<{ path: string; mtime: Date }> {
  const path = sidecarPathForImage(imagePath);
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const original = await readFileSnapshot(path);
    const merged = mergeXmp(original?.text, metadata);
    const temporary = `${path}.photoctl-${randomUUID()}.tmp`;
    let file: Awaited<ReturnType<typeof open>> | undefined;
    let published = false;
    try {
      const created = await filesystem(
        "create",
        temporary,
        async () => await open(temporary, "wx", original?.mode),
      );
      file = created;
      await filesystem("write", temporary, async () => await created.writeFile(merged, "utf8"));
      if (original) {
        await filesystem(
          "set permissions on",
          temporary,
          async () => await created.chmod(original.mode),
        );
      }
      await filesystem("flush", temporary, async () => await created.sync());
      const written = await filesystem("inspect", temporary, async () => await created.stat());
      await filesystem("close", temporary, async () => await created.close());
      file = undefined;

      await hooks.beforeSnapshotCompare?.(attempt);
      const current = await readFileSnapshot(path);
      if (current?.identity !== original?.identity) continue;

      await hooks.afterSnapshotCompare?.(attempt);
      if (!(await publishXmpSnapshot(path, temporary, original?.identity))) continue;
      published = true;
      const directory = await filesystem(
        "open parent directory for",
        path,
        async () => await open(dirname(path), "r"),
      );
      try {
        await filesystem("flush parent directory for", path, async () => await directory.sync());
      } finally {
        await directory.close().catch(() => undefined);
      }
      return { path, mtime: written.mtime };
    } finally {
      await file?.close().catch(() => undefined);
      if (!published) await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  throw new XmpChangedError(`XMP sidecar changed repeatedly while writing: ${path}`);
}

export function mergeXmp(original: string | undefined, metadata: XmpCullMetadata): string {
  if (original === undefined) return createXmp(metadata);
  const elements = scanElements(original);
  const descriptions = elements.filter((element) => element.name === "rdf:Description");
  if (descriptions.length === 0) throw new InvalidXmpError("XMP has no rdf:Description");
  for (const description of descriptions) validateDescriptionNamespaces(description);

  const edits: Edit[] = [];
  for (const [index, description] of descriptions.entries()) {
    const opening = original.slice(description.openStart, description.openEnd);
    if (index === 0) {
      if (description.selfClosing) {
        const expanded = addOwnedAttributes(
          ensureNamespaces(opening.replace(/\/\s*>$/, ">"), description.namespaces),
          metadata,
        );
        edits.push({
          start: description.openStart,
          end: description.openEnd,
          text: `${expanded}${ownedElements(metadata)}</rdf:Description>`,
        });
      } else {
        edits.push({
          start: description.openStart,
          end: description.openEnd,
          text: addOwnedAttributes(ensureNamespaces(opening, description.namespaces), metadata),
        });
        if (description.closeStart === undefined) {
          throw new InvalidXmpError("XMP rdf:Description is not closed");
        }
        edits.push({
          start: description.closeStart,
          end: description.closeStart,
          text: ownedElements(metadata),
        });
      }
    } else {
      edits.push({
        start: description.openStart,
        end: description.openEnd,
        text: stripOwnedAttributes(opening),
      });
    }
  }

  for (const element of elements) {
    if (!isOwnedElement(element) || !insideDescription(element)) continue;
    if (hasOwnedAncestor(element)) continue;
    if (element.selfClosing) {
      edits.push({ start: element.openStart, end: element.openEnd, text: "" });
    } else if (element.closeEnd !== undefined) {
      edits.push({ start: element.openStart, end: element.closeEnd, text: "" });
    } else {
      throw new InvalidXmpError(`XMP ${element.name} element is not closed`);
    }
  }
  return applyEdits(original, edits);
}

interface XmlElement {
  name: string;
  openStart: number;
  openEnd: number;
  closeStart?: number;
  closeEnd?: number;
  selfClosing: boolean;
  namespaces: Map<string, string>;
  parent?: XmlElement;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

function scanElements(xml: string): XmlElement[] {
  const elements: XmlElement[] = [];
  const stack: XmlElement[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start < 0) break;
    if (xml.startsWith("<!--", start)) {
      cursor = terminatedAt(xml, start, "-->");
      continue;
    }
    if (xml.startsWith("<![CDATA[", start)) {
      cursor = terminatedAt(xml, start, "]]>");
      continue;
    }
    if (xml.startsWith("<?", start)) {
      cursor = terminatedAt(xml, start, "?>");
      continue;
    }
    const end = findTagEnd(xml, start) + 1;
    const tag = xml.slice(start, end);
    if (tag.startsWith("<!")) {
      cursor = end;
      continue;
    }
    const closing = /^<\s*\//.test(tag);
    const name = /^<\s*\/?\s*([^\s/>]+)/.exec(tag)?.[1];
    if (!name) throw new InvalidXmpError("XMP contains an invalid element tag");
    if (closing) {
      const element = stack.pop();
      if (!element || element.name !== name) {
        throw new InvalidXmpError(`XMP element ${name} is not correctly nested`);
      }
      element.closeStart = start;
      element.closeEnd = end;
    } else {
      const parent = stack.at(-1);
      const namespaces = new Map(parent?.namespaces);
      for (const [prefix, uri] of namespaceDeclarations(tag)) namespaces.set(prefix, uri);
      const element: XmlElement = {
        name,
        openStart: start,
        openEnd: end,
        selfClosing: /\/\s*>$/.test(tag),
        namespaces,
        ...(parent ? { parent } : {}),
      };
      elements.push(element);
      if (!element.selfClosing) stack.push(element);
    }
    cursor = end;
  }
  if (stack.length > 0)
    throw new InvalidXmpError(`XMP element ${stack.at(-1)?.name} is not closed`);
  return elements;
}

function namespaceDeclarations(opening: string): Array<[string, string]> {
  const declarations: Array<[string, string]> = [];
  const pattern = /\s+xmlns:([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of opening.matchAll(pattern)) {
    declarations.push([match[1], match[2] ?? match[3]]);
  }
  return declarations;
}

function validateDescriptionNamespaces(description: XmlElement): void {
  for (const [prefix, expected] of NAMESPACES) {
    const actual = description.namespaces.get(prefix);
    if (
      (prefix === "rdf" && actual !== expected) ||
      (actual !== undefined && actual !== expected)
    ) {
      throw new InvalidXmpError(`XMP prefix ${prefix} uses an unexpected namespace`);
    }
  }
}

function ensureNamespaces(opening: string, inScope: Map<string, string>): string {
  let merged = stripOwnedAttributes(opening);
  for (const [prefix, uri] of NAMESPACES) {
    if (prefix === "rdf" || inScope.has(prefix)) continue;
    merged = merged.replace(/>$/, ` xmlns:${prefix}="${uri}">`);
  }
  return merged;
}

function stripOwnedAttributes(opening: string): string {
  let merged = opening;
  for (const name of OWNED_ATTRIBUTES) {
    merged = merged.replace(
      new RegExp(`\\s+${name.replace(":", "\\:")}\\s*=\\s*(?:"[^"]*"|'[^']*')`, "g"),
      "",
    );
  }
  return merged;
}

function addOwnedAttributes(opening: string, metadata: XmpCullMetadata): string {
  return opening.replace(/>$/, `${ownedAttributes(metadata)}>`);
}

function insideDescription(element: XmlElement): boolean {
  let current = element.parent;
  while (current) {
    if (current.name === "rdf:Description") return true;
    current = current.parent;
  }
  return false;
}

function isOwnedElement(element: XmlElement): boolean {
  if (!OWNED_ELEMENTS.has(element.name)) return false;
  const prefix = element.name.split(":", 1)[0];
  return element.namespaces.get(prefix) === OWNED_ELEMENT_NAMESPACES.get(prefix);
}

function hasOwnedAncestor(element: XmlElement): boolean {
  let current = element.parent;
  while (current && current.name !== "rdf:Description") {
    if (isOwnedElement(current)) return true;
    current = current.parent;
  }
  return false;
}

function applyEdits(original: string, edits: Edit[]): string {
  let merged = original;
  for (const edit of edits.toSorted(
    (left, right) => right.start - left.start || right.end - left.end,
  )) {
    merged = merged.slice(0, edit.start) + edit.text + merged.slice(edit.end);
  }
  return merged;
}

function createXmp(metadata: XmpCullMetadata): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoctl="${PHOTOCTL_NAMESPACE}"${ownedAttributes(metadata)}>${ownedElements(metadata)}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function ownedAttributes(metadata: XmpCullMetadata): string {
  const label = metadata.label ? ` xmp:Label="${capitalize(metadata.label)}"` : "";
  return ` xmp:Rating="${metadata.rating}"${label} photoctl:flag="${metadata.flag}"`;
}

function ownedElements(metadata: XmpCullMetadata): string {
  const items = metadata.tags.map((tag) => `<rdf:li>${escapeXml(tag)}</rdf:li>`).join("");
  return `
      <dc:subject><rdf:Bag>${items}</rdf:Bag></dc:subject>`;
}

function findTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  throw new InvalidXmpError("XMP element opening tag is not closed");
}

function terminatedAt(xml: string, start: number, terminator: string): number {
  const end = xml.indexOf(terminator, start + 1);
  if (end < 0) throw new InvalidXmpError(`XMP ${terminator} section is not closed`);
  return end + terminator.length;
}

function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function filesystem<T>(
  operation: string,
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new XmpFilesystemError(operation, path, error);
  }
}
