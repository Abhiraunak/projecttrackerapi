import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { toDate, toDay } from "../../lib/dates.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { refreshAlertsSoon } from "../alerts/alerts.service.js";
import { checkItem, recordMovementIn } from "../inventory/inventory.service.js";
import { sendToUsers } from "../push/push.service.js";
import { logger } from "../../config/logger.js";
import { FROM, TO } from "./requests.rules.js";
const requestInclude = {
    material: { select: { id: true, name: true, unit: true } },
    boqItem: { select: { id: true, code: true, title: true } },
    requestedBy: { select: { id: true, email: true } },
    decidedBy: { select: { email: true } },
    order: { select: { id: true, reference: true } },
    project: { select: { id: true, title: true } },
};
export const requestDto = (r) => ({
    id: r.id,
    material: r.material,
    boqItem: r.boqItem,
    quantity: r.quantity.toNumber(),
    neededBy: r.neededBy ? toDay(r.neededBy) : null,
    note: r.note,
    status: r.status,
    requestedBy: r.requestedBy,
    decidedBy: r.decidedBy?.email ?? null,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    order: r.order,
    movementId: r.movementId,
    createdAt: r.createdAt,
});
const qtyWords = (r) => `${typeof r.quantity === "number" ? r.quantity : r.quantity.toNumber()} ${r.material.unit} ${r.material.name}`;
/* -------------------------------- notifications -------------------------------- */
function notify(userIds, title, body, projectId, tag) {
    void sendToUsers(userIds, { title, body, url: `/dashboard/inventory?project=${encodeURIComponent(projectId)}&tab=requests`, tag }).catch((err) => logger.error({ err }, "request notification failed"));
}
async function approvers(exceptId) {
    const users = await prisma.user.findMany({ where: { OR: [{ role: "ADMIN" }, { permissions: { has: "requests.approve" } }], NOT: { id: exceptId } }, select: { id: true } });
    return users.map((u) => u.id);
}
/* ---------------------------------- reading ---------------------------------- */
export async function listRequests(userId, projectId, status) {
    await requirePermission(userId, projectId, "materials.view");
    const rows = await prisma.materialRequest.findMany({
        where: { projectId, ...(status === "open" ? { status: { in: ["PENDING", "APPROVED"] } } : {}) },
        include: requestInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
    });
    // Waiting for approval first, then approved, then the rest, newest first within each
    const rank = { PENDING: 0, APPROVED: 1 };
    return rows.map(requestDto).sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2));
}
async function load(id) {
    const row = await prisma.materialRequest.findUnique({ where: { id }, include: requestInclude });
    if (!row)
        throw new HttpError(404, "Request not found");
    return row;
}
/* ---------------------------------- changing ---------------------------------- */
export async function createRequest(userId, projectId, body) {
    await requirePermission(userId, projectId, "requests.create");
    const material = await prisma.material.findUnique({ where: { id: body.materialId }, select: { id: true } });
    if (!material)
        throw new HttpError(404, "Material not found");
    await checkItem(projectId, "ISSUED", body.boqItemId); // must be an active BOQ item of this project
    const row = await prisma.$transaction(async (tx) => {
        const created = await tx.materialRequest.create({
            data: { projectId, materialId: body.materialId, boqItemId: body.boqItemId, quantity: body.quantity, neededBy: body.neededBy ? toDate(body.neededBy) : null, note: body.note, requestedById: userId },
            include: requestInclude,
        });
        await recordAudit(tx, { projectId, actorId: userId, action: "request.created", entityType: "requirement", entityId: created.id, summary: `Requested ${qtyWords(created)} for ${created.boqItem?.code ?? "a BOQ item"}` });
        return created;
    });
    notify(await approvers(userId), `Material request: ${row.project.title}`, `${row.requestedBy.email} needs ${qtyWords(row)}${row.neededBy ? ` by ${toDay(row.neededBy)}` : ""}`, projectId, `request-${row.id}`);
    return requestDto(row);
}
/**
 * Moves a request on, only from a status the action allows. The status check and the change are one statement,
 * so two people approving and rejecting at the same moment can't both succeed.
 */
async function claim(tx, id, action, userId, note) {
    const done = await tx.materialRequest.updateMany({
        where: { id, status: { in: FROM[action] } },
        data: { status: TO[action], decidedById: userId, decidedAt: new Date(), ...(note ? { decisionNote: note } : {}) },
    });
    if (done.count === 0)
        throw new HttpError(409, "This request has already been handled by someone else. Refresh to see where it is.");
}
/** Approve, reject or cancel */
export async function decide(userId, id, action, note) {
    const request = await load(id);
    const ownCancel = action === "cancel" && request.requestedById === userId;
    if (ownCancel)
        await requirePermission(userId, request.projectId, "materials.view");
    else
        await requirePermission(userId, request.projectId, "requests.approve");
    if (action === "reject" && note.trim().length < 3)
        throw new HttpError(400, "Say why it is rejected, so the person who asked knows.");
    const row = await prisma.$transaction(async (tx) => {
        await claim(tx, id, action, userId, note);
        const verb = { approve: "Approved", reject: "Rejected", cancel: "Cancelled" }[action];
        await recordAudit(tx, { projectId: request.projectId, actorId: userId, action: { approve: "request.approved", reject: "request.rejected", cancel: "request.cancelled" }[action], entityType: "requirement", entityId: id, summary: `${verb} the request for ${qtyWords(request)}${note ? `: ${note}` : ""}` });
        return tx.materialRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    });
    if (!ownCancel && request.requestedById !== userId) {
        const word = { approve: "approved", reject: "rejected", cancel: "cancelled" }[action];
        notify([request.requestedById], `Request ${word}`, `${qtyWords(request)} for ${request.boqItem?.code ?? "your BOQ item"}${note ? `: ${note}` : ""}`, request.projectId, `request-${id}`);
    }
    return requestDto(row);
}
/** Issues the approved material from the store to the request's BOQ item: the request and the stock entry together */
export async function issue(userId, id, body) {
    const request = await load(id);
    await requirePermission(userId, request.projectId, "stock.issue");
    if (!request.boqItemId)
        throw new HttpError(400, "The BOQ item of this request was removed. Reject it and ask again.");
    const material = await prisma.material.findUniqueOrThrow({ where: { id: request.materialId } });
    const quantity = body.quantity ?? request.quantity.toNumber();
    const row = await prisma.$transaction(async (tx) => {
        await claim(tx, id, "issue", userId, body.note);
        const movement = await recordMovementIn(tx, userId, request.projectId, { materialId: material.id, type: "ISSUED", quantity, boqItemId: request.boqItemId, orderId: null, note: body.note || `Request from ${request.requestedBy.email}` }, material);
        return tx.materialRequest.update({ where: { id }, data: { movementId: movement.id }, include: requestInclude });
    });
    refreshAlertsSoon(request.projectId);
    if (request.requestedById !== userId) {
        notify([request.requestedById], "Material issued", `${quantity} ${material.unit} ${material.name} issued for ${request.boqItem?.code ?? "your BOQ item"}`, request.projectId, `request-${id}`);
    }
    return requestDto(row);
}
/** Places an order for an approved request (nothing, or not enough, in the store) */
export async function orderFor(userId, id, body) {
    const request = await load(id);
    await requirePermission(userId, request.projectId, "requirements.order");
    if (body.vendorId && !(await prisma.vendor.findUnique({ where: { id: body.vendorId }, select: { id: true } })))
        throw new HttpError(400, "That vendor could not be found.");
    const quantity = body.quantity ?? request.quantity.toNumber();
    const row = await prisma.$transaction(async (tx) => {
        await claim(tx, id, "order", userId, "");
        const order = await tx.materialOrder.create({
            data: {
                projectId: request.projectId,
                materialId: request.materialId,
                vendorId: body.vendorId,
                quantity,
                rate: body.rate,
                expectedDelivery: body.expectedDelivery ? toDate(body.expectedDelivery) : null,
                reference: body.reference,
                note: `For ${request.requestedBy.email}'s request (${request.boqItem?.code ?? "BOQ item"})`,
                createdById: userId,
            },
        });
        await recordAudit(tx, { projectId: request.projectId, actorId: userId, action: "order.created", entityType: "requirement", entityId: order.id, summary: `Ordered ${quantity} ${request.material.unit} of ${request.material.name} for a request` });
        return tx.materialRequest.update({ where: { id }, data: { orderId: order.id }, include: requestInclude });
    });
    refreshAlertsSoon(request.projectId);
    if (request.requestedById !== userId) {
        notify([request.requestedById], "Material ordered", `${quantity} ${request.material.unit} ${request.material.name} ordered for ${request.boqItem?.code ?? "your BOQ item"}${body.expectedDelivery ? `, expected ${body.expectedDelivery}` : ""}`, request.projectId, `request-${id}`);
    }
    return requestDto(row);
}
/** Requests waiting for this person's approval, across projects (for the count in the menu) */
export async function pendingForMe(userId) {
    const access = await requireCan(userId, "materials.view");
    if (!access.permissions.includes("requests.approve"))
        return 0;
    return prisma.materialRequest.count({ where: { status: "PENDING", project: { status: "ONGOING" } } });
}
//# sourceMappingURL=requests.service.js.map