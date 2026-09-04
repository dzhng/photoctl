import { expect, test } from "vitest";
import { renderSheetReport } from "./sheet.js";

test("the sheet keeps rating, flag, label, and online badges legible beside each preview", () => {
  const html = renderSheetReport({
    library: "/tmp/photoctl-library",
    filter: "rating>=4",
    photos: [
      {
        row: {
          id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001",
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
});
