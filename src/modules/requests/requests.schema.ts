import { z } from "zod";

const id = z.string().min(1).max(64);
const qty = z.number().finite().positive().max(1_000_000_000);

export const createRequestSchema = z.object({
  body: z.object({
    materialId: id,
    boqItemId: id, // what it's for: issuing needs a BOQ item
    quantity: qty,
    neededBy: z.union([z.iso.date(), z.null()]).default(null),
    note: z.string().trim().max(300).default(""),
  }),
});

export const decideSchema = z.object({ body: z.object({ note: z.string().trim().max(300).default("") }) });

/** Issue: the quantity may be less than asked for (only part is in the store) */
export const issueSchema = z.object({ body: z.object({ quantity: qty.optional(), note: z.string().trim().max(200).default("") }) });

export const orderFromRequestSchema = z.object({
  body: z.object({
    quantity: qty.optional(),
    rate: z.number().finite().min(0).max(100_000_000).default(0),
    vendorId: id.nullable().default(null),
    expectedDelivery: z.union([z.iso.date(), z.null()]).default(null),
    reference: z.string().trim().max(60).default(""),
  }),
});

export const listQuerySchema = z.object({ status: z.enum(["open", "all"]).default("open") });

export type CreateRequestBody = z.infer<typeof createRequestSchema>["body"];
export type IssueBody = z.infer<typeof issueSchema>["body"];
export type OrderFromRequestBody = z.infer<typeof orderFromRequestSchema>["body"];
