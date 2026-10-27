import { z } from "zod";
import { PERMISSIONS } from "../../lib/permissions.js";

export const updateAccessSchema = z.object({
  body: z.object({
    isAdmin: z.boolean(),
    permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
  }),
});

export type UpdateAccessBody = z.infer<typeof updateAccessSchema>["body"];
