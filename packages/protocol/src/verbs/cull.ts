import { z } from "zod";

export const cullLabelSchema = z.enum(["red", "yellow", "green", "blue", "purple"]);
export const cullFlagSchema = z.enum(["pick", "reject", "none"]);

export const listRowSchema = z.object({
  id: z.uuid(),
  file: z.string(),
  rating: z.number().int().min(0).max(5),
  flag: cullFlagSchema,
  label: cullLabelSchema.nullable(),
  shot: z.string().nullable(),
  online: z.boolean(),
});

export const listDataSchema = z.object({
  rows: z.array(listRowSchema),
  total: z.number().int().nonnegative(),
});

export const nextDataSchema = listRowSchema.extend({
  preview: z.string(),
  remaining: z.number().int().nonnegative(),
});

export type CullLabel = z.infer<typeof cullLabelSchema>;
export type CullFlag = z.infer<typeof cullFlagSchema>;
export type ListRow = z.infer<typeof listRowSchema>;
export type ListData = z.infer<typeof listDataSchema>;
export type NextData = z.infer<typeof nextDataSchema>;
