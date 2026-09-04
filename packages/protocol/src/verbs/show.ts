import { z } from "zod";
import { fullHashSchema } from "../hash.js";

const affineSchema = z.object({
  a: z.number(),
  b: z.number(),
  c: z.number(),
  d: z.number(),
  e: z.number(),
  f: z.number(),
});

const pointSchema = z.tuple([z.number(), z.number()]);

export const showDataSchema = z.object({
  id: z.uuid(),
  dims: z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    orientation: z.number().int().min(1).max(8),
    note: z.string(),
  }),
  crop: z.null(),
  camera: z.object({
    make: z.string().nullable(),
    model: z.string().nullable(),
    lens: z.string().nullable(),
  }),
  exposure: z.object({
    shutter: z.string().nullable(),
    f: z.number().nullable(),
    iso: z.number().int().nullable(),
    focal_mm: z.number().nullable(),
    wb: z.string().nullable(),
  }),
  shot: z.string().nullable(),
  rating: z.number().int().min(0).max(5),
  flag: z.enum(["pick", "reject", "none"]),
  label: z.enum(["red", "yellow", "green", "blue", "purple"]).nullable(),
  tags: z.array(z.string()),
  preview: z.string(),
  preview_info: z.object({
    render_hash: fullHashSchema("r"),
    view_hash: fullHashSchema("v"),
    requested: z.object({
      region: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
      long_edge: z.union([z.number().int().positive(), z.literal("native")]),
    }),
    actual: z.object({
      region: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      w: z.number().int().positive(),
      h: z.number().int().positive(),
    }),
    source_tier: z.enum(["online-file", "online-jpeg-range", "pinned-preview"]),
    source_dimensions: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
    }),
    pixel_scale: z.number().positive(),
    resolution_limited: z.boolean(),
    cache_source: z.enum(["exact_view", "sufficient_full_frame", "render_master"]),
    color_space: z.literal("srgb"),
    icc: z.literal("sRGB2014"),
    base_to_view: affineSchema,
    view_to_base: affineSchema,
    visible_base_polygon: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]),
  }),
  locators: z.array(z.object({ volume: z.string(), path: z.string(), online: z.boolean() })),
  content_key: z.string().regex(/^ck_[0-9a-f]{16}$/),
  develop: z.record(z.string(), z.unknown()),
  develop_hash: z.string().nullable(),
  render_hash: fullHashSchema("r"),
  layers: z.object({
    count: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
  }),
  xmp: z.unknown().nullable(),
});

export type ShowData = z.infer<typeof showDataSchema>;
