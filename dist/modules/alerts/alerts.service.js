import { prisma } from "../../lib/prisma.js";
import { toDay } from "../../lib/dates.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { logger } from "../../config/logger.js";
import { buildInventory } from "../inventory/stock.js";
import { stockInputs } from "../inventory/inventory.service.js";
import { toMaterialInfo } from "../inventory/inventory.mapper.js";
import { sendToUsers } from "../push/push.service.js";
import { computeAlerts, diffAlerts, shouldNotify, todayInIndia } from "./alerts.js";
/** People who act on stock alerts: admins, and anyone who receives stock or places orders */
async function alertRecipients() {
    const users = await prisma.user.findMany({
        where: { OR: [{ role: "ADMIN" }, { permissions: { hasSome: ["stock.receive", "requirements.order"] } }] },
        select: { id: true },
    });
    return users.map((u) => u.id);
}
async function currentAlerts(projectId) {
    const { entries, needs, orders: orderFigures, items } = await stockInputs(prisma, projectId);
    const ids = [...new Set([...entries.map((e) => e.materialId), ...needs.map((n) => n.materialId), ...orderFigures.map((o) => o.materialId)])];
    const [materials, orders] = await Promise.all([
        prisma.material.findMany({ where: { id: { in: ids } } }),
        prisma.materialOrder.findMany({
            where: { projectId, expectedDelivery: { not: null } },
            include: { material: { select: { name: true, unit: true } }, vendor: { select: { name: true } } },
        }),
    ]);
    const stock = buildInventory(materials.map(toMaterialInfo), entries, needs, orderFigures, items);
    const alertOrders = orders.map((o) => ({
        id: o.id,
        materialId: o.materialId,
        materialName: o.material.name,
        unit: o.material.unit,
        reference: o.reference,
        vendorName: o.vendor?.name ?? null,
        pendingQty: Math.max(0, o.quantity.toNumber() - o.receivedQty.toNumber()),
        expectedDelivery: o.expectedDelivery ? toDay(o.expectedDelivery) : null,
    }));
    return computeAlerts(stock, alertOrders, todayInIndia());
}
/**
 * Brings one project's open alerts in line with its stock now: opens new ones (and pushes them, at most once a day
 * per alert), closes the ones whose cause has gone, and re-words the rest.
 */
export async function refreshAlerts(projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, title: true, status: true } });
    if (!project)
        return;
    const now = new Date();
    const current = project.status === "ONGOING" ? await currentAlerts(projectId) : []; // finished projects raise nothing
    const open = await prisma.stockAlert.findMany({ where: { projectId, resolvedAt: null }, select: { id: true, key: true, message: true } });
    const { create, resolve, reword } = diffAlerts(open, current);
    if (resolve.length)
        await prisma.stockAlert.updateMany({ where: { id: { in: resolve } }, data: { resolvedAt: now } });
    for (const r of reword)
        await prisma.stockAlert.update({ where: { id: r.id }, data: { message: r.message } });
    if (create.length === 0)
        return;
    const toPush = [];
    for (const alert of create) {
        const last = await prisma.stockAlert.findFirst({ where: { key: alert.key, projectId, notifiedAt: { not: null } }, orderBy: { notifiedAt: "desc" }, select: { notifiedAt: true } });
        const push = shouldNotify(last?.notifiedAt ?? null, now);
        await prisma.stockAlert.create({
            data: { projectId, key: alert.key, kind: alert.kind, materialId: alert.materialId, orderId: alert.orderId, message: alert.message, notifiedAt: push ? now : null },
        });
        if (push)
            toPush.push(alert);
    }
    if (toPush.length === 0)
        return;
    const recipients = await alertRecipients();
    const url = `/dashboard/inventory?project=${encodeURIComponent(projectId)}&tab=stock`;
    if (toPush.length === 1) {
        await sendToUsers(recipients, { title: project.title, body: toPush[0].message, url, tag: `alert-${projectId}-${toPush[0].key}` });
    }
    else {
        // Several at once (a big sync, the morning sweep): one notification, not a burst
        await sendToUsers(recipients, { title: `${project.title}: ${toPush.length} stock alerts`, body: toPush.slice(0, 3).map((a) => a.message.split(":")[0]).join(" · "), url, tag: `alerts-${projectId}` });
    }
}
/** After a change, in the background: a slow push service never delays the request that caused it */
export function refreshAlertsSoon(projectId) {
    void refreshAlerts(projectId).catch((err) => logger.error({ err, projectId }, "stock alert refresh failed"));
}
/** A material's minimum changed: every ongoing project that uses it */
export function refreshAlertsForMaterial(materialId) {
    void (async () => {
        const projects = await prisma.project.findMany({
            where: { status: "ONGOING", OR: [{ stockMovements: { some: { materialId } } }, { boqItems: { some: { materials: { some: { materialId } } } } }] },
            select: { id: true },
        });
        for (const p of projects)
            await refreshAlerts(p.id);
    })().catch((err) => logger.error({ err, materialId }, "stock alert refresh failed"));
}
/** Every ongoing project, one after the other (late deliveries become late by the calendar, not by a change) */
export async function sweepAlerts() {
    const projects = await prisma.project.findMany({ where: { status: "ONGOING" }, select: { id: true } });
    for (const p of projects) {
        await refreshAlerts(p.id).catch((err) => logger.error({ err, projectId: p.id }, "stock alert sweep failed"));
    }
}
/**
 * Runs the sweep a minute after start, then every few hours. Call once from server.ts after listen().
 * (On several server instances it simply runs on each: alerts are de-duplicated by key and pushed once a day.)
 */
export function startAlertSweep(everyHours = 3) {
    const run = () => void sweepAlerts().catch((err) => logger.error({ err }, "stock alert sweep failed"));
    setTimeout(run, 60_000).unref();
    setInterval(run, everyHours * 3600_000).unref();
}
/* ------------------------------- for the screens ------------------------------- */
const alertDto = (a) => ({
    id: a.id,
    kind: a.kind,
    key: a.key,
    message: a.message,
    materialId: a.materialId,
    orderId: a.orderId,
    openedAt: a.openedAt,
});
export async function listProjectAlerts(userId, projectId) {
    await requirePermission(userId, projectId, "materials.view");
    const rows = await prisma.stockAlert.findMany({ where: { projectId, resolvedAt: null }, orderBy: [{ kind: "asc" }, { openedAt: "desc" }] });
    return rows.map(alertDto);
}
/** Open alerts on every ongoing project, for the count in the menu */
export async function listAllAlerts(userId) {
    await requireCan(userId, "materials.view");
    const rows = await prisma.stockAlert.findMany({
        where: { resolvedAt: null, project: { status: "ONGOING" } },
        include: { project: { select: { id: true, title: true } } },
        orderBy: { openedAt: "desc" },
        take: 200,
    });
    return rows.map((r) => ({ ...alertDto(r), project: r.project }));
}
//# sourceMappingURL=alerts.service.js.map