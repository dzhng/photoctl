import { z } from "zod";
import { fullHashSchema } from "../hash.js";

export const undoDataSchema = z.object({
  id: z.string().uuid(),
  undone: z.boolean(),
  revision_id: z.string().uuid(),
  render_hash: fullHashSchema("r"),
});

export type UndoData = z.infer<typeof undoDataSchema>;
