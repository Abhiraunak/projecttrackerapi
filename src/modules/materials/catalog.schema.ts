import { z } from "zod";

export const createMaterialSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(80),
    unit: z.string().trim().min(1).max(20),
    category: z.string().trim().max(40).default("General"),
    minStock: z.number().finite().min(0).max(1_000_000_000).default(0),
    rate: z.number().finite().min(0).max(100_000_000).default(0), // standard rate per unit, ₹
  }),
});

/** Editing sends every field again */
export const updateMaterialSchema = createMaterialSchema;

export const createVendorSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    contactPerson: z.string().trim().max(80).default(""),
    phone: z.string().trim().max(20).default(""),
    email: z.union([z.literal(""), z.email().max(120)]).default(""),
  }),
});

export const updateVendorSchema = createVendorSchema;

export type MaterialBody = z.infer<typeof createMaterialSchema>["body"];
export type VendorBody = z.infer<typeof createVendorSchema>["body"];

/** Inside a project, the catalog is the project owner's. Without projectId it is your own. */
export const catalogQuerySchema = z.object({ projectId: z.string().min(1).max(64).optional() });
