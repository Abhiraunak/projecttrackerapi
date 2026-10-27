import { z } from "zod";

export const AUDIT_ENTITIES = ["project", "task", "member", "requirement", "stock", "attendance", "user"] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** req.query is read-only in Express 5, so the controller parses it directly */
export const auditQuerySchema = z.object({
  entityType: z.enum(AUDIT_ENTITIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;
