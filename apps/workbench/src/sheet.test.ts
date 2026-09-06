import { expect, test } from "vitest";
import { renderSheetReport } from "./sheet.js";

test("the sheet includes rating, flag, label, and original availability beside each preview", () => {
  const html = renderSheetReport({
    library: "/tmp/photoctl-library",
    filter: "rating>=4",
    photos: [
      {
        row: {
          id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001",
          primary_original_id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002",
          originals: [
            { id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002", kind: "raw", online: true },
            { id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003", kind: "jpeg", online: false },
          ],
          file: "DSC00001.ARW",
          rating: 5,
          flag: "pick",
          label: "green",
          shot: "2025-01-01T10:00:00+00:00",
          online: true,
        },
        preview: "/tmp/cache/preview.jpg",
        show: { schema: 1, ok: true, data: { id: "photo" }, warnings: [] },
      },
    ],
  });

  expect(html).toContain("★★★★★");
  expect(html).toContain("Pick");
  expect(html).toContain("Green");
  expect(html).toContain("Online");
  expect(html).toContain("Show JSON");
  expect(html).toContain("RAW · Primary · Online");
  expect(html).toContain("JPEG · Offline");
});

test("the sheet template renders a mixed-availability pair as one RAW-led card", () => {
  const html = renderSheetReport({
    library: "/tmp/photoctl-library",
    filter: null,
    photos: [
      {
        row: {
          id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001",
          primary_original_id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002",
          originals: [
            { id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003", kind: "jpeg", online: true },
            { id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002", kind: "raw", online: false },
          ],
          file: "DSC08819.ARW",
          rating: 0,
          flag: "none",
          label: null,
          shot: null,
          online: false,
        },
        preview: "/tmp/cache/retained-raw-preview.jpg",
        show: { schema: 1, ok: true, data: { id: "photo" }, warnings: [] },
      },
    ],
  });

  const cards = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];
  expect(cards).toHaveLength(1);
  const [card] = cards;
  expect(card).toContain("<h2>DSC08819.ARW</h2>");
  expect(card).toContain("0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001");
  expect(card).toMatch(/<span\b[^>]*>RAW · Primary · Offline<\/span>/);
  expect(card).toMatch(/<span\b[^>]*>JPEG · Online<\/span>/);
  expect(card).toMatch(/<span class="online"><i><\/i>Offline<\/span>/);
  expect(card).toContain('data-online="false"');
});
