import { z } from "zod";
const asArray = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
export const createDrawingSchema = z.object({
    body: z.object({
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).default(""),
        sharedWith: z.preprocess(asArray, z.array(z.string().min(1).max(64)).max(50)),
    }),
});
export const shareDrawingSchema = z.object({
    body: z.object({ userIds: z.array(z.string().min(1).max(64)).max(50) }),
});
export const listQuerySchema = z.object({
    scope: z.enum(["all", "mine", "shared"]).default("all"),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(8),
});
//# sourceMappingURL=drawings.schema.js.map