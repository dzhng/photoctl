export interface ExportTemplateValues {
  date: string | null;
  sequence: number;
  stem: string;
  id: string;
  rating: number;
}

const FIELD = /\{([^{}]+)\}/gu;
const LOCAL_DATE = /^(\d{4}-\d{2}-\d{2})T/u;

export function renderExportTemplate(template: string, values: ExportTemplateValues): string {
  const filename = template.replace(FIELD, (_token, field: string) => {
    if (field === "stem") return values.stem;
    if (field === "id8") return values.id.slice(0, 8);
    if (field === "rating") return String(values.rating);
    if (field === "seq") return String(values.sequence);
    if (field === "date") {
      const localDate = values.date?.match(LOCAL_DATE)?.[1];
      if (!localDate) throw new Error("{date} requires a photographed shot-local date");
      return localDate;
    }
    const sequence = field.match(/^seq:(\d+)$/u);
    if (sequence) {
      const width = Number(sequence[1]);
      if (!Number.isSafeInteger(width) || width < 1 || width > 12) {
        throw new Error("Export template sequence width must be between 1 and 12");
      }
      return String(values.sequence).padStart(width, "0");
    }
    throw new Error(`Export template has unknown field: {${field}}`);
  });
  if (filename.includes("{") || filename.includes("}")) {
    throw new Error("Export template contains an unmatched brace");
  }
  if (
    filename.length === 0 ||
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  ) {
    throw new Error("Export template must produce one non-empty, single safe filename");
  }
  return filename;
}
