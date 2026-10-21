import type { Request, Response } from "express";
import { listAudit, listCompanyAudit } from "./audit.service.js";
import { auditQuerySchema, companyAuditQuerySchema } from "./audit.schema.js";

/** GET /projects/:projectId/audit: one project's history */
export async function list(req: Request<{ projectId: string }>, res: Response) {
  const query = auditQuerySchema.parse(req.query);
  res.json(await listAudit(req.user!.sub, req.params.projectId, query));
}

/** GET /audit: changes outside any project (BOQs, access), or ?all=true for everything */
export async function listCompany(req: Request, res: Response) {
  const query = companyAuditQuerySchema.parse(req.query);
  res.json(await listCompanyAudit(req.user!.sub, query));
}
