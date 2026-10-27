import { listAudit, listCompanyAudit } from "./audit.service.js";
import { auditQuerySchema, companyAuditQuerySchema } from "./audit.schema.js";
/** GET /projects/:projectId/audit: one project's history */
export async function list(req, res) {
    const query = auditQuerySchema.parse(req.query);
    res.json(await listAudit(req.user.sub, req.params.projectId, query));
}
/** GET /audit: changes outside any project (BOQs, access), or ?all=true for everything */
export async function listCompany(req, res) {
    const query = companyAuditQuerySchema.parse(req.query);
    res.json(await listCompanyAudit(req.user.sub, query));
}
//# sourceMappingURL=audit.controller.js.map