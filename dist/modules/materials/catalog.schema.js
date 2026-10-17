import { z } from "zod";
export const createMaterialSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1).max(80),
        unit: z.string().trim().min(1).max(20),
        category: z.string().trim().max(40).default("General"),
        minStock: z.number().finite().min(0).max(1_000_000_000).default(0),
    }),
});
export const createVendorSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1).max(120),
        contactPerson: z.string().trim().max(80).default(""),
        phone: z.string().trim().max(20).default(""),
        email: z.union([z.literal(""), z.email().max(120)]).default(""),
    }),
});
//# sourceMappingURL=catalog.schema.js.map