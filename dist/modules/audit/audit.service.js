import { prisma } from "../../lib/prisma.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { hasChanges } from "./audit.diff.js";
/**
 * Writes one audit entry. Pass the transaction (`tx`) the change itself runs in,
 * so the change and its record are saved together or not at all.
 */
export async function recordAudit(db, input) {
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
            changes: input.changes && hasChanges(input.changes) ? input.changes : undefined,
        },
    });
}
/** One project's history: who changed what on it, newest first */
export async function listAudit(userId, projectId, query) {
    await requirePermission(userId, projectId, "audit.view");
    return pageOfEntries({ projectId, ...(query.entityType ? { entityType: query.entityType } : {}) }, query);
}
/**
 * Changes that belong to no project: BOQs, and who may do what (admin page).
 * Add ?all=true to include every project's entries too.
 */
export async function listCompanyAudit(userId, query) {
    await requireCan(userId, "audit.view");
    return pageOfEntries({ ...(query.all ? {} : { projectId: null }), ...(query.entityType ? { entityType: query.entityType } : {}) }, query);
}
/**
 * The Activity feed in the bell (admins, or anyone allowed to see the activity log): what everyone did, newest
 * first, across every project or one. With who did it by name and the project's title.
 */
/** Which log entries each filter in the Recent activity panel shows */
const TYPES = {
    materials: { entityType: { in: ["material_delivery", "material", "requirement", "stock"] } },
    labour: { entityType: "attendance" },
    payments: { entityType: { in: ["payment", "expense"] } },
    projects: { entityType: { in: ["project", "task", "member", "boq", "equipment", "site_report", "user"] } },
};
export async function listActivity(userId, query) {
    await requireCan(userId, "audit.view");
    const where = {
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.days ? { createdAt: { gte: new Date(Date.now() - query.days * 24 * 60 * 60 * 1000) } } : {}),
        ...(query.type ? TYPES[query.type] : {}),
    };
    const rows = await prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize + 1, // one more tells whether there is a next page
        select: {
            id: true,
            action: true,
            entityType: true,
            summary: true,
            actorEmail: true,
            createdAt: true,
            actor: { select: { name: true } },
            project: { select: { id: true, title: true } },
        },
    });
    return {
        items: rows.slice(0, query.pageSize).map((r) => ({
            id: r.id,
            action: r.action,
            entityType: r.entityType,
            summary: r.summary,
            actor: r.actor?.name || r.actorEmail,
            project: r.project,
            createdAt: r.createdAt.toISOString(),
        })),
        page: query.page,
        hasMore: rows.length > query.pageSize,
    };
}
async function pageOfEntries(where, { page, pageSize }) {
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
//# sourceMappingURL=audit.service.js.map