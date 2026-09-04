import { z } from "zod";

export function fullHashSchema<Prefix extends string>(prefix: Prefix) {
  return z.templateLiteral([z.literal(`${prefix}_`), z.string().regex(/^[0-9a-f]{64}$/)]);
}
