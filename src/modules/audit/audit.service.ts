
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { hasChanges, type Changes } from "./audit.diff.js";
import type { AuditEntity, AuditQuery } from "./audit.schema.js";

type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditInput {
  projectId: string | null; // null for company-wide changes, like who may do what
  actorId: string;
  action: string; // "requirement.order_updated"
  entityType: AuditEntity;
  entityId?: string | null;
  summary: string; // a sentence people can read
  changes?: Changes;
}

/**
 * Writes one audit entry. Pass the transaction (`tx`) the change itself runs in,
 * so the change and its record are saved together or not at all.
 */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  const actor = await db.user.findUnique({ where: { id: input.actorId }, select: { email: true } });
  await db.auditLog.create({
    data: {
      projectId: input.projectId,
      actorId: input.actorId,
      actorEmail: actor?.email ?? "unknown",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      changes: input.changes && hasChanges(input.changes) ? (input.changes as Prisma.InputJsonValue) : undefined,
    },
  });
}

/** One project's history: who changed what on it, newest first */
export async function listAudit(userId: string, projectId: string, query: AuditQuery) {
  await requirePermission(userId, projectId, "audit.view");
  return pageOfEntries({ projectId, ...(query.entityType ? { entityType: query.entityType } : {}) }, query);
}

/**
 * Changes that belong to no project: BOQs, and who may do what (admin page).
 * Add ?all=true to include every project's entries too.
 */
export async function listCompanyAudit(userId: string, query: AuditQuery & { all?: boolean }) {
  await requireCan(userId, "audit.view");
  return pageOfEntries({ ...(query.all ? {} : { projectId: null }), ...(query.entityType ? { entityType: query.entityType } : {}) }, query);
}

async function pageOfEntries(where: Prisma.AuditLogWhereInput, { page, pageSize }: AuditQuery) {
  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], // id breaks ties so pages never repeat or skip a row
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      summary: row.summary,
      changes: row.changes,
      actor: row.actorEmail,
      createdAt: row.createdAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
