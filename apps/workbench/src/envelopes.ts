import { exitCodeFor, type Envelope, type ExportResult, type ShowData } from "@photoctl/protocol";

export interface EnvelopeExample {
  title: string;
  note: string;
  exitCode: number;
  envelope: Envelope;
}

const photoId = "01991227-cc00-7000-8000-000000000001";

const successfulShow = {
  schema: 1,
  ok: true,
  data: {
    id: photoId,
    dims: { w: 7008, h: 4672, orientation: 1, note: "oriented base pixels" },
    crop: null,
    camera: { make: "SONY", model: "ILCE-7M4", lens: "FE 35mm F1.4 GM" },
    exposure: { shutter: "1/250", f: 2.8, iso: 100, focal_mm: 35, wb: null },
    shot: "2023-10-02T18:18:37+02:00",
    rating: 0,
    flag: "none",
    label: null,
    tags: [],
    preview: `/tmp/cache/emb/${photoId}.jpg`,
    preview_info: {
      render_hash: "r_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      view_hash: "v_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      requested: { region: null, long_edge: 1616 },
      actual: { region: [0, 0, 7008, 4672], w: 1616, h: 1077 },
      source_tier: "pinned-preview",
      source_dimensions: { w: 1616, h: 1077 },
      pixel_scale: 1616 / 7008,
      resolution_limited: false,
      cache_source: "exact_view",
      color_space: "srgb",
      icc: "sRGB2014",
      base_to_view: { a: 1616 / 7008, b: 0, c: 0, d: 1077 / 4672, e: 0, f: 0 },
      view_to_base: { a: 7008 / 1616, b: 0, c: 0, d: 4672 / 1077, e: 0, f: 0 },
      visible_base_polygon: [
        [0, 0],
        [7008, 0],
        [7008, 4672],
        [0, 4672],
      ],
    },
    locators: [{ volume: "fixture-volume", path: "a7c2.ARW", online: true }],
    content_key: "ck_0123456789abcdef",
    develop: {},
    develop_hash: null,
    render_hash: "r_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    layers: { count: 0, stale: 0 },
    xmp: null,
  },
  warnings: [],
} satisfies Envelope<ShowData>;

const lockedLibrary = {
  schema: 1,
  ok: false,
  code: "library_locked",
  data: { holder_pid: 4217, waited_ms: 30_000 },
  warnings: [],
} satisfies Envelope;

const successfulExport = {
  id: photoId,
  ok: true,
  file: "/tmp/out/a7c2.jpg",
  w: 7008,
  h: 4672,
  bytes: 6_730_200,
  render_hash: "r_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  skipped: false,
} satisfies ExportResult;

const partialExport = {
  schema: 1,
  ok: false,
  code: "partial",
  summary: { ok: 1, failed: 1 },
  results: [
    successfulExport,
    {
      id: "missing-photo",
      ok: false,
      code: "not_found",
      message: "No photo matches missing-photo",
    },
  ],
  warnings: [],
} satisfies Envelope;

export const envelopeExamples: EnvelopeExample[] = [
  {
    title: "Successful show",
    note: "A single-value success keeps its payload under data.",
    exitCode: 0,
    envelope: successfulShow,
  },
  {
    title: "Library locked",
    note: "Temporary contention is a failure envelope and exits 75 so an agent may retry.",
    exitCode: exitCodeFor(lockedLibrary.code),
    envelope: lockedLibrary,
  },
  {
    title: "Partial export",
    note: "Batch outcomes keep every item beside an aggregate summary.",
    exitCode: exitCodeFor(partialExport.code),
    envelope: partialExport,
  },
];
