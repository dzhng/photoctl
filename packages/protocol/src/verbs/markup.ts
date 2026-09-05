import { z } from "zod";
import { fullHashSchema } from "../hash.js";

const coordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000);
const extentSchema = z.number().positive().max(1_000_000);
const pointSchema = z.tuple([coordinateSchema, coordinateSchema]);
const bboxSchema = z.tuple([coordinateSchema, coordinateSchema, extentSchema, extentSchema]);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);
const widthSchema = z.number().positive().max(10_000);
const textSchema = z
  .object({
    type: z.literal("text"),
    at: pointSchema,
    text: z.string().min(1).max(4_096),
    size_px: z.number().positive().max(10_000),
    color: colorSchema,
  })
  .strict();
const segmentFields = {
  from: pointSchema,
  to: pointSchema,
  width: widthSchema,
  color: colorSchema,
};
const arrowSchema = z.object({ type: z.literal("arrow"), ...segmentFields }).strict();
const lineSchema = z.object({ type: z.literal("line"), ...segmentFields }).strict();
const shapeFields = {
  bbox: bboxSchema,
  width: widthSchema,
  color: colorSchema,
  fill: colorSchema.optional(),
};
const rectSchema = z.object({ type: z.literal("rect"), ...shapeFields }).strict();
const ellipseSchema = z.object({ type: z.literal("ellipse"), ...shapeFields }).strict();
const pathSchema = z
  .object({
    type: z.literal("path"),
    points: z.array(pointSchema).min(2).max(8_192),
    width: widthSchema,
    color: colorSchema,
  })
  .strict();
const highlightSchema = z
  .object({
    type: z.literal("highlight"),
    bbox: bboxSchema,
    color: colorSchema,
    opacity: z.number().min(0).max(1),
  })
  .strict();

export const markupItemInputSchema = z.discriminatedUnion("type", [
  textSchema,
  arrowSchema,
  lineSchema,
  rectSchema,
  ellipseSchema,
  pathSchema,
  highlightSchema,
]);
export type MarkupItemInput = z.infer<typeof markupItemInputSchema>;
export const markupItemSchema = z.intersection(
  z.object({ id: z.uuid() }).strict(),
  markupItemInputSchema,
);
export type MarkupItem = z.infer<typeof markupItemSchema>;
const maxTextRasterPixels = 64_000_000;
const maxPathPoints = 65_536;
export const markupDocumentSchema = z
  .array(markupItemSchema)
  .max(2_048)
  .superRefine((document, context) => {
    const pixels = document.reduce(
      (sum, item) =>
        item.type === "text"
          ? sum + Math.ceil(item.size_px) ** 2 * Array.from(item.text).length
          : sum,
      0,
    );
    if (pixels > maxTextRasterPixels) {
      context.addIssue({
        code: "custom",
        message: "markup text exceeds the rasterization budget",
      });
    }
    const points = document.reduce(
      (sum, item) => sum + (item.type === "path" ? item.points.length : 0),
      0,
    );
    if (points > maxPathPoints) {
      context.addIssue({
        code: "custom",
        message: "markup document has too many path points",
      });
    }
  });
export type MarkupDocument = z.infer<typeof markupDocumentSchema>;

export const markupDataSchema = z.object({
  id: z.uuid(),
  revision_id: z.uuid(),
  render_hash: fullHashSchema("r"),
  node: fullHashSchema("node"),
  changed: z.enum(["add", "update", "remove", "clear"]).nullable(),
  items: markupDocumentSchema,
});
export type MarkupData = z.infer<typeof markupDataSchema>;
