import { prisma } from "../../lib/prisma.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { requiredQty } from "../materialPlan/plan.js";
import { materialCosts } from "./cost.js";
/** What the BOQ's materials need, per material, for active items only */
async function requiredByMaterial(projectIds) {
    const lines = await prisma.boqItemMaterial.findMany({
        where: { item: { projectId: { in: projectIds }, active: true } },
        select: { materialId: true, perUnit: true, wastagePercent: true, item: { select: { projectId: true, quantity: true } } },
    });
    const byProject = new Map();
    for (const l of lines) {
        const map = byProject.get(l.item.projectId) ?? new Map();
        const need = requiredQty(l.item.quantity.toNumber(), { perUnit: l.perUnit.toNumber(), wastagePercent: l.wastagePercent.toNumber() });
        map.set(l.materialId, (map.get(l.materialId) ?? 0) + need);
        byProject.set(l.item.projectId, map);
    }
    return byProject;
}
async function costInputs(projectIds) {
    const [required, orders, loose] = await Promise.all([
        requiredByMaterial(projectIds),
        prisma.materialOrder.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, materialId: true, quantity: true, receivedQty: true, rate: true } }),
        prisma.stockMovement.groupBy({ by: ["projectId", "materialId"], where: { projectId: { in: projectIds }, type: "RECEIVED", orderId: null }, _sum: { quantity: true } }),
    ]);
    const ids = new Set([...orders.map((o) => o.materialId), ...loose.map((l) => l.materialId)]);
    for (const map of required.values())
        for (const id of map.keys())
            ids.add(id);
    const materials = await prisma.material.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, unit: true, rate: true } });
    return (projectId) => materialCosts({
        materials: materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, rate: m.rate.toNumber() })),
        required: required.get(projectId) ?? new Map(),
        orders: orders.filter((o) => o.projectId === projectId).map((o) => ({ materialId: o.materialId, quantity: o.quantity.toNumber(), receivedQty: o.receivedQty.toNumber(), rate: o.rate.toNumber() })),
        receivedWithoutOrder: new Map(loose.filter((l) => l.projectId === projectId).map((l) => [l.materialId, l._sum.quantity?.toNumber() ?? 0])),
    });
}
/** One project's material cost: budget from the BOQ, ordered, spent (received) and expected, per material */
export async function getMaterialCost(userId, projectId) {
    await requirePermission(userId, projectId, "materials.view");
    return (await costInputs([projectId]))(projectId);
}
/** For the project list and cards: material spent and expected per project, in one round of queries */
export async function materialTotalsByProject(projectIds) {
    if (projectIds.length === 0)
        return new Map();
    const costOf = await costInputs(projectIds);
    return new Map(projectIds.map((id) => {
        const { totals } = costOf(id);
        return [id, { spent: totals.spent, expected: totals.expected }];
    }));
}
//# sourceMappingURL=cost.service.js.map