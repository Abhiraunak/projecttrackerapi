import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { toDate, toDay } from "../../lib/dates.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { diffFields, hasChanges } from "../audit/audit.diff.js";
import { recordAudit } from "../audit/audit.service.js";
import { refreshAlertsSoon } from "../alerts/alerts.service.js";
const orderInclude = {
    material: { select: { id: true, name: true, unit: true } },
    vendor: { select: { id: true, name: true } },
    createdBy: { select: { email: true } },
};
export { orderInclude };
export const orderDto = (o) => {
    const quantity = o.quantity.toNumber();
    const receivedQty = o.receivedQty.toNumber();
    const rate = o.rate.toNumber();
    return {
        id: o.id,
        material: o.material,
        vendor: o.vendor,
        quantity,
        receivedQty,
        pendingQty: Math.max(0, Math.round((quantity - receivedQty) * 1000) / 1000),
        rate,
        value: Math.round(quantity * rate * 100) / 100, // order value
        receivedValue: Math.round(receivedQty * rate * 100) / 100,
        expectedDelivery: o.expectedDelivery ? toDay(o.expectedDelivery) : null,
        reference: o.reference,
        note: o.note,
        createdBy: o.createdBy.email,
        createdAt: o.createdAt,
    };
};
async function assertVendor(vendorId) {
    if (vendorId && !(await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }))) {
        throw new HttpError(400, "That vendor could not be found.");
    }
}
async function loadOrder(id) {
    const order = await prisma.materialOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order)
        throw new HttpError(404, "Order not found");
    return order;
}
/** Newest first; open orders (something still to arrive) before completed ones */
export async function listOrders(userId, projectId) {
    await requirePermission(userId, projectId, "materials.view");
    const rows = await prisma.materialOrder.findMany({ where: { projectId }, include: orderInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const orders = rows.map(orderDto);
    return [...orders.filter((o) => o.pendingQty > 0), ...orders.filter((o) => o.pendingQty === 0)];
}
export async function createOrder(userId, projectId, body) {
    await requirePermission(userId, projectId, "requirements.order");
    const material = await prisma.material.findUnique({ where: { id: body.materialId }, select: { id: true, name: true, unit: true } });
    if (!material)
        throw new HttpError(404, "Material not found");
    await assertVendor(body.vendorId);
    const row = await prisma.$transaction(async (tx) => {
        const created = await tx.materialOrder.create({
            data: { ...body, expectedDelivery: body.expectedDelivery ? toDate(body.expectedDelivery) : null, projectId, createdById: userId },
            include: orderInclude,
        });
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "order.created",
            entityType: "requirement",
            entityId: created.id,
            summary: `Ordered ${body.quantity} ${material.unit} of ${material.name}${body.rate ? ` at ₹${body.rate}` : ""}${created.vendor ? ` from ${created.vendor.name}` : ""}${body.reference ? ` (${body.reference})` : ""}`,
            changes: { quantity: { from: null, to: body.quantity } },
        });
        return created;
    });
    refreshAlertsSoon(projectId);
    return orderDto(row);
}
export async function updateOrder(userId, id, body) {
    const before = await loadOrder(id);
    await requirePermission(userId, before.projectId, "requirements.order");
    await assertVendor(body.vendorId);
    if (body.quantity < before.receivedQty.toNumber()) {
        throw new HttpError(400, `${before.receivedQty.toNumber()} ${before.material.unit} has already been received on this order: the quantity can't be less.`);
    }
    const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.materialOrder.update({
            where: { id },
            data: { ...body, expectedDelivery: body.expectedDelivery ? toDate(body.expectedDelivery) : null },
            include: orderInclude,
        });
        const view = (o) => ({ quantity: o.quantity.toNumber(), rate: o.rate.toNumber(), vendor: o.vendor?.name ?? null, expectedDelivery: o.expectedDelivery ? toDay(o.expectedDelivery) : null, reference: o.reference });
        const changes = diffFields(view(before), view(updated), ["quantity", "rate", "vendor", "expectedDelivery", "reference"]);
        if (hasChanges(changes)) {
            await recordAudit(tx, { projectId: before.projectId, actorId: userId, action: "order.updated", entityType: "requirement", entityId: id, summary: `Updated the order for ${before.material.name}`, changes });
        }
        return updated;
    });
    refreshAlertsSoon(before.projectId);
    return orderDto(row);
}
/** Only an order with nothing received yet can be deleted: deliveries must keep the order they came on */
export async function deleteOrder(userId, id) {
    const order = await loadOrder(id);
    await requirePermission(userId, order.projectId, "requirements.delete");
    if (order.receivedQty.toNumber() > 0)
        throw new HttpError(409, "Stock has been received on this order, so it can't be deleted. Change its quantity instead.");
    await prisma.$transaction(async (tx) => {
        await tx.materialOrder.delete({ where: { id } });
        await recordAudit(tx, {
            projectId: order.projectId,
            actorId: userId,
            action: "order.deleted",
            entityType: "requirement",
            entityId: id,
            summary: `Deleted the order for ${order.quantity.toNumber()} ${order.material.unit} of ${order.material.name}`,
        });
    });
    refreshAlertsSoon(order.projectId);
}
//# sourceMappingURL=orders.service.js.map