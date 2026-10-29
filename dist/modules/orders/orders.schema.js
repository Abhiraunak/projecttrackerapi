import { z } from "zod";
const id = z.string().min(1).max(64);
const qty = z.number().finite().positive().max(1_000_000_000);
const fields = {
    vendorId: id.nullable().default(null),
    quantity: qty,
    rate: z.number().finite().min(0).max(100_000_000).default(0), // agreed price per unit, ₹
    expectedDelivery: z.union([z.iso.date(), z.null()]).default(null),
    reference: z.string().trim().max(60).default(""),
    note: z.string().trim().max(300).default(""),
};
export const createOrderSchema = z.object({ body: z.object({ materialId: id, ...fields }) });
export const updateOrderSchema = z.object({ body: z.object(fields) }); // the material of an order can't change
//# sourceMappingURL=orders.schema.js.map