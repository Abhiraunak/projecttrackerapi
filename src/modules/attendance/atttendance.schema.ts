import { z } from "zod";

const amount = z.number().finite().min(0).max(1_000_000_000);

const worker = z.object({
  id: z.string().max(64).optional(), // ignored: workers are replaced on every save
  label: z.string().trim().min(1).max(40),
  amount,
});

const fields = {
  contractorName: z.string().trim().min(1).max(120),
  date: z.string().date(), // Validates strictly against "YYYY-MM-DD"
  workers: z.array(worker).min(1).max(100),
  extras: amount.default(0),
  notes: z.string().trim().max(500).default(""),
};

// 1. Export the schemas directly for req.body validation
export const createBodySchema = z.object({ 
  projectId: z.string().min(1).max(64), 
  ...fields 
});

export const updateBodySchema = z.object({ 
  ...fields 
}); // a record can't move to another project

/** req.query is read-only in Express 5, so the controller parses it directly */
export const listQuerySchema = z.object({
  projectId: z.string().min(1).max(64).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(5),
});

// 2. Infer types directly from the new schemas
export type CreateBody = z.infer<typeof createBodySchema>;
export type UpdateBody = z.infer<typeof updateBodySchema>;