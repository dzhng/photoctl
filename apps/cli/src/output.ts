import type { Envelope, ErrorCode, Warning } from "@photoctl/protocol";

export function renderHuman(envelope: Envelope): string {
  const lines: string[] = [];

  if (!envelope.ok) {
    lines.push(
      `Error [${envelope.code}]: ${escapeText(messageFrom(envelope.data) ?? errorLabel(envelope.code))}`,
    );
  }

  if ("results" in envelope && envelope.results !== undefined) {
    lines.push(renderResults(envelope.results));
  } else if ("data" in envelope && envelope.ok) {
    const list = asListData(envelope.data);
    if (list) lines.push(renderList(list.rows), `Total: ${list.total}`);
    else lines.push(renderFields(envelope.data));
  } else if ("data" in envelope) {
    const details = withoutMessage(envelope.data);
    if (Object.keys(details).length > 0) lines.push(renderFields(details));
  }

  if ("summary" in envelope && envelope.summary) {
    lines.push(`Summary: ${envelope.summary.ok} succeeded, ${envelope.summary.failed} failed`);
  }

  for (const warning of envelope.warnings ?? []) lines.push(renderWarning(warning));
  return `${lines.join("\n")}\n`;
}

function asListData(value: unknown): { rows: unknown[]; total: number } | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.rows) && typeof record.total === "number"
    ? { rows: record.rows, total: record.total }
    : undefined;
}

function renderList(rows: unknown[]): string {
  const columns = ["id", "file", "rating", "flag", "label", "shot", "online"];
  return renderTable(
    columns.map((column) => column.toUpperCase()),
    rows.map((value) => {
      const row = asRecord(value);
      return columns.map((column) => formatValue(row[column]));
    }),
  );
}

function renderFields(value: unknown): string {
  return renderTable(["FIELD", "VALUE"], flattenFields(asRecord(value)));
}

function renderResults(results: unknown[]): string {
  const rows = results.map(asRecord);
  if (rows.length === 0) return "No results";
  const present = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) present.add(key);
  const leading = ["id", "ok", "code"].filter((key) => present.delete(key));
  const columns = [...leading, ...[...present].toSorted(compareKeys)];
  return renderTable(
    columns.map((column) => column.toUpperCase()),
    rows.map((row) => columns.map((column) => formatValue(row[column]))),
  );
}

function renderTable(headers: string[], rows: string[][]): string {
  return [
    renderRow(headers),
    headers.map((header) => "-".repeat(header.length)).join(" | "),
    ...rows.map(renderRow),
  ].join("\n");
}

function renderRow(row: string[]): string {
  return row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function flattenFields(value: Record<string, unknown>, prefix = ""): string[][] {
  const entries = Object.entries(value).toSorted(([left], [right]) => compareKeys(left, right));
  if (entries.length === 0) return [[prefix || "value", "{}"]];
  return entries.flatMap(([key, fieldValue]) => {
    const field = prefix ? `${prefix}.${key}` : key;
    if (fieldValue !== null && typeof fieldValue === "object" && !Array.isArray(fieldValue)) {
      return flattenFields(fieldValue as Record<string, unknown>, field);
    }
    return [[field, formatValue(fieldValue)]];
  });
}

function withoutMessage(value: unknown): Record<string, unknown> {
  const details = { ...asRecord(value) };
  delete details.message;
  return details;
}

function messageFrom(value: unknown): string | undefined {
  const message = asRecord(value).message;
  return typeof message === "string" ? message : undefined;
}

function renderWarning(warning: Warning): string {
  return `Warning [${warning.code}]${warning.id ? ` (${escapeText(warning.id)})` : ""}: ${escapeText(warning.message)}`;
}

function errorLabel(code: ErrorCode): string {
  if (code === "partial") return "Partial failure";
  const words = code.replaceAll("_", " ");
  return `${words[0].toUpperCase()}${words.slice(1)}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return escapeText(abbreviateHash(value));
  if (value === undefined) return "";
  if (value === true) return "yes";
  if (value === false) return "no";
  return JSON.stringify(abbreviateHashes(value)) ?? "";
}

function abbreviateHashes(value: unknown): unknown {
  if (typeof value === "string") return abbreviateHash(value);
  if (Array.isArray(value)) return value.map(abbreviateHashes);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, abbreviateHashes(nested)]),
    );
  }
  return value;
}

function abbreviateHash(value: string): string {
  return value.replace(
    /^(r|v|recipe|node|eval|exec|a|h)_([0-9a-f]{64})$/,
    (_match, prefix: string, digest: string) => `${prefix}_${digest.slice(0, 12)}`,
  );
}

function escapeText(value: string): string {
  return JSON.stringify(value)
    .slice(1, -1)
    .replace(
      /\p{Cc}/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
