import { prisma } from "../../lib/prisma.js";
import { requireCan } from "../../lib/projectAccess.js";
import { equipmentHireByProject } from "../equipment/equipment.service.js";
const num = (v) => v?.toNumber() ?? 0;
const round2 = (n) => Math.round(n * 100) / 100;
const empty = () => ({
    labour: { attendance: 0, contract: 0, total: 0, paid: 0, toPay: 0 },
    material: { deliveries: 0, total: 0, planned: 0 },
    equipment: 0,
    general: 0,
    total: 0,
});
/** For many projects in one round of queries (the project cards), or one (the Overview) */
export async function spendByProject(projectIds) {
    const out = new Map(projectIds.map((id) => [id, empty()]));
    if (projectIds.length === 0)
        return out;
    const where = { projectId: { in: projectIds } };
    const [attendance, contract, payments, deliveries, planned, general, hire] = await Promise.all([
        prisma.attendance.groupBy({ by: ["projectId"], where, _sum: { totalAmount: true } }),
        prisma.labourMeasure.groupBy({ by: ["projectId"], where, _sum: { amount: true } }),
        prisma.contractorPayment.groupBy({ by: ["projectId"], where, _sum: { amount: true } }),
        prisma.materialDelivery.groupBy({ by: ["projectId"], where, _sum: { amount: true } }),
        prisma.materialPurchase.groupBy({ by: ["projectId"], where, _sum: { amount: true } }),
        prisma.expense.groupBy({ by: ["projectId"], where: { ...where, category: "general" }, _sum: { amount: true } }),
        equipmentHireByProject(projectIds),
    ]);
    for (const r of attendance)
        out.get(r.projectId).labour.attendance = num(r._sum.totalAmount);
    for (const r of contract)
        out.get(r.projectId).labour.contract = num(r._sum.amount);
    for (const r of payments)
        out.get(r.projectId).labour.paid = num(r._sum.amount);
    for (const r of deliveries)
        out.get(r.projectId).material.deliveries = num(r._sum.amount);
    for (const r of planned)
        out.get(r.projectId).material.planned = num(r._sum.amount);
    for (const r of general)
        out.get(r.projectId).general = num(r._sum.amount);
    for (const [id, v] of hire)
        out.get(id).equipment = v;
    for (const s of out.values()) {
        s.labour.total = round2(s.labour.attendance + s.labour.contract);
        s.labour.toPay = round2(s.labour.total - s.labour.paid); // below 0: paid in advance
        s.material.total = round2(s.material.deliveries);
        s.general = round2(s.general);
        s.total = round2(s.labour.total + s.material.total + s.equipment + s.general);
    }
    return out;
}
/** GET /projects/:id/spend: anyone who can open the project sees its totals (no line items) */
export async function projectSpend(userId, projectId) {
    await requireCan(userId, "project.view");
    return (await spendByProject([projectId])).get(projectId);
}
//# sourceMappingURL=spend.service.js.map