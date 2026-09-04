import { z } from "zod";
export const versionDataSchema = z.object({ version: z.string() });
export type VersionData = z.infer<typeof versionDataSchema>;
