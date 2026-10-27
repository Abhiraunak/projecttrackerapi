import { z } from "zod";
export const AUDIT_ENTITIES = ["project", "task", "member", "requirement", "stock", "attendance", "user", "boq"];
/** req.query is read-only in Express 5, so the controller parses it directly */
export const auditQuerySchema = z.object({
    entityType: z.enum(AUDIT_ENTITIES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
/** The company-wide list also takes ?all=true (every entry, not only those outside projects) */
export const companyAuditQuerySchema = auditQuerySchema.extend({
    all: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
});
//# sourceMappingURL=audit.schema.js.map