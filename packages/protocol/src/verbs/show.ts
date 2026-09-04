import { z } from "zod";

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
  locators: z.array(z.object({ volume: z.string(), path: z.string(), online: z.boolean() })),
  content_key: z.string().regex(/^ck_[0-9a-f]{16}$/),
  develop: z.record(z.string(), z.unknown()),
  develop_hash: z.string().nullable(),
  layers: z.object({
    count: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
  }),
  xmp: z.unknown().nullable(),
});

export type ShowData = z.infer<typeof showDataSchema>;
