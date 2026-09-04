import { expect, test } from "vitest";
import { renderExportTemplate } from "./template.js";

test("template values use the photographed local date and batch position in every host timezone", () => {
  const input = {
    date: "2023-10-02T18:18:37+02:00",
    sequence: 1,
    stem: "a7c2",
    id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001",
    rating: 5,
  };

  expect(renderExportTemplate("{date}_{seq:03}_{stem}_{id8}_{rating}", input)).toBe(
    "2023-10-02_001_a7c2_0199a7c2_5",
  );
});

test("templates reject unknown fields, unsafe path components, and malformed sequence widths", () => {
  const input = {
    date: null,
    sequence: 1,
    stem: "a7c2",
    id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001",
    rating: 0,
  };

  expect(() => renderExportTemplate("../{stem}", input)).toThrow(/single safe filename/u);
  expect(() => renderExportTemplate("{camera}", input)).toThrow(/unknown field/u);
  expect(() => renderExportTemplate("{seq:0}", input)).toThrow(/sequence width/u);
  expect(() => renderExportTemplate("{date}", input)).toThrow(/shot-local date/u);
});
