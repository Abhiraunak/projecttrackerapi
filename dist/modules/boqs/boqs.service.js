import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { recordAudit } from "../audit/audit.service.js";
import { boqDto, boqInclude, boqSummaryDto, derivedColumns } from "./boqs.mapper.js";
const WEEK_MS = 7 * 86_400_000;
const asJson = (document) => document;
async function findOrThrow(id) {
    const row = await prisma.boq.findUnique({ where: { id }, include: boqInclude });
    if (!row)
        throw new HttpError(404, "BOQ not found");
    return row;
}
function searchFilter(q) {
    if (!q)
        return {};
    const contains = { contains: q, mode: "insensitive" };
    return { OR: [{ title: contains }, { subtitle: contains }, { boqNumber: contains }] };
}
/** The dashboard: one page of BOQs (newest change first) and the figures for its summary cards */
export async function listBoqs({ q, status, projectId, page, pageSize }) {
    const where = { ...searchFilter(q), ...(status ? { status } : {}), ...(projectId ? { projectId } : {}) };
    const [rows, total, sum, drafts, finals, recent] = await prisma.$transaction([
        prisma.boq.findMany({ where, include: boqInclude, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
        prisma.boq.count({ where }),
        prisma.boq.aggregate({ _sum: { grandTotal: true }, _count: { _all: true } }),
        prisma.boq.count({ where: { status: "DRAFT" } }),
        prisma.boq.count({ where: { status: "FINAL" } }),
        prisma.boq.count({ where: { updatedAt: { gte: new Date(Date.now() - WEEK_MS) } } }),
    ]);
    return {
        items: rows.map(boqSummaryDto),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        stats: { count: sum._count._all, drafts, finals, totalValue: sum._sum.grandTotal?.toNumber() ?? 0, updatedThisWeek: recent },
    };
}
export async function getBoq(id) {
    return boqDto(await findOrThrow(id));
}
async function assertProject(projectId) {
    if (projectId && !(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
        throw new HttpError(400, "That project could not be found.");
    }
}
export async function createBoq(userId, document, projectId = null) {
    await assertProject(projectId);
    const row = await prisma.$transaction(async (tx) => {
        const created = await tx.boq.create({
            data: { ...derivedColumns(document), document: asJson(document), projectId, createdById: userId, updatedById: userId },
            include: boqInclude,
        });
        await recordAudit(tx, { projectId: null, actorId: userId, action: "boq.created", entityType: "boq", entityId: created.id, summary: `Created BOQ "${document.title || "Untitled"}"` });
        return created;
    });
    return boqDto(row);
}
/**
 * A copy to start a new BOQ from: always a draft, marked "Copy of", and linked to no project
 * (linked to the same project, both copies would feed its materials and count everything twice).
 */
export async function duplicateBoq(userId, sourceId) {
    const source = await findOrThrow(sourceId);
    const document = source.document;
    return createBoq(userId, { ...document, title: `Copy of ${document.title || "Untitled"}`, boqNumber: "" }, null);
}
/**
 * Saves the whole document. Two rules:
 *  - the version must match the stored one, or someone else saved meanwhile (409, nothing is overwritten)
 *  - a FINAL BOQ is locked: the only change allowed is reopening it as a DRAFT
 */
export async function saveBoq(userId, id, { document, version, status }) {
    const current = await findOrThrow(id);
    if (current.status === "FINAL" && status === "FINAL") {
        throw new HttpError(409, "This BOQ is final. Reopen it as a draft to edit it.");
    }
    const row = await prisma.$transaction(async (tx) => {
        // The version in the condition makes "check, then write" one step: a parallel save can't slip in between
        const result = await tx.boq.updateMany({
            where: { id, version },
            data: { ...derivedColumns(document), document: asJson(document), status, version: { increment: 1 }, updatedById: userId },
        });
        if (result.count === 0)
            throw new HttpError(409, "Someone else saved this BOQ while you were editing. Reload to see their changes.");
        if (status !== current.status) {
            await recordAudit(tx, {
                projectId: null,
                actorId: userId,
                action: status === "FINAL" ? "boq.finalised" : "boq.reopened",
                entityType: "boq",
                entityId: id,
                summary: `${status === "FINAL" ? "Marked final" : "Reopened as draft"}: "${document.title || "Untitled"}"`,
                changes: { status: { from: current.status, to: status } },
            });
        }
        return tx.boq.findUniqueOrThrow({ where: { id }, include: boqInclude });
    });
    return boqDto(row);
}
export async function deleteBoq(userId, id) {
    const current = await findOrThrow(id);
    await prisma.$transaction(async (tx) => {
        await tx.boq.delete({ where: { id } });
        await recordAudit(tx, {
            projectId: null,
            actorId: userId,
            action: "boq.deleted",
            entityType: "boq",
            entityId: id,
            summary: `Deleted BOQ "${current.title || "Untitled"}" (total ${current.grandTotal.toNumber()})`,
        });
    });
}
/**
 * Moves a BOQ to a project (or to none). Allowed even when the BOQ is final: it changes where its items are counted,
 * not the BOQ itself. The project's materials update on its next "Sync from BOQ".
 */
export async function setBoqProject(userId, id, projectId) {
    const current = await findOrThrow(id);
    if (current.projectId === projectId)
        return boqDto(current);
    await assertProject(projectId);
    const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.boq.update({ where: { id }, data: { projectId }, include: boqInclude });
        const from = current.project?.title ?? null;
        const to = updated.project?.title ?? null;
        await recordAudit(tx, {
            projectId: null,
            actorId: userId,
            action: "boq.project_changed",
            entityType: "boq",
            entityId: id,
            summary: to ? `Linked BOQ "${current.title || "Untitled"}" to project "${to}"` : `Unlinked BOQ "${current.title || "Untitled"}" from its project`,
            changes: { project: { from, to } },
        });
        return updated;
    });
    return boqDto(row);
}
//# sourceMappingURL=boqs.service.js.map