import { z } from "zod";

const id = z.string().min(1).max(64);

export const createRequirementSchema = z.object({
  body: z.object({
    taskId: id,
    materialId: id,
    requiredQty: z.number().finite().positive().max(1_000_000_000),
    wastagePercent: z.number().finite().min(0).max(50).default(5),
  }),
});

export const updateOrderSchema = z.object({
  body: z.object({
    vendorId: id.nullable(),
    orderedQty: z.number().finite().min(0).max(1_000_000_000),
    expectedDelivery: z.iso.date().nullable(), // "YYYY-MM-DD"
    requested: z.boolean(),
  }),
});

export type CreateRequirementBody = z.infer<typeof createRequirementSchema>["body"];
export type OrderBody = z.infer<typeof updateOrderSchema>["body"];
