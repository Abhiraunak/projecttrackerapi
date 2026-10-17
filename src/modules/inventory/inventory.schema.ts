import { z } from "zod";

const id = z.string().min(1).max(64);

export const createMovementSchema = z.object({
  body: z.object({
    materialId: id,
    type: z.enum(["RECEIVED", "ISSUED", "RESERVED", "RELEASED", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
    quantity: z.number().finite().positive().max(1_000_000_000),
    taskId: id.nullable().default(null),
    requirementId: id.nullable().default(null),
    note: z.string().trim().max(200).default(""),
  }),
});

/** req.query is read-only in Express 5, so the controller parses it directly */
export const movementsQuerySchema = z.object({
  materialId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(8),
});

export type MovementBody = z.infer<typeof createMovementSchema>["body"];
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;
