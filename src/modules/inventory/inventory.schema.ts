import { z } from "zod";

const id = z.string().min(1).max(64);

export const createMovementSchema = z.object({
  body: z.object({
    materialId: id,
    type: z.enum(["RECEIVED", "ISSUED", "RESERVED", "RELEASED", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
    quantity: z.number().finite().positive().max(1_000_000_000),
    boqItemId: id.nullable().default(null), // issued / reserved / released: which BOQ item
    orderId: id.nullable().default(null), // received: which order it arrived on (optional)
    note: z.string().trim().max(200).default(""),
    date: z.iso.date().optional(), // the day it happened; today when left out
    vendorName: z.string().trim().max(120).default(""), // received: who supplied it (optional)
  }),
});

/** The Materials tab's Received / Issued / Correct stock form: sent as a form, because a bill photo may come with it */
export const quickMoveSchema = z.object({
  body: z.object({
    materialId: id,
    type: z.enum(["RECEIVED", "ISSUED", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
    quantity: z.coerce.number().finite().positive("Enter a quantity greater than zero.").max(1_000_000_000),
    date: z.iso.date().optional(),
    note: z.string().trim().max(200).default(""),
    vendorName: z.string().trim().max(120).default(""),
  }),
});
export type QuickMoveBody = z.infer<typeof quickMoveSchema>["body"];

/** req.query is read-only in Express 5, so the controller parses it directly */
export const movementsQuerySchema = z.object({
  materialId: id.optional(),
  boqItemId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export type MovementBody = z.infer<typeof createMovementSchema>["body"];
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;