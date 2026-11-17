import { prisma } from "../../lib/prisma.js";
import { requireCan } from "../../lib/projectAccess.js";
import { equipmentHireByProject } from "../equipment/equipment.service.js";

const num = (v: { toNumber(): number } | null | undefined) => v?.toNumber() ?? 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What a project has actually spent, taken only from the workspace sections, so the Overview, the Expenditure tab and
 * the project cards add up to exactly what those sections show:
 *  - Labour    = attendance (Labour › Week / Saved attendance) + contract work (Labour › Contract work);
 *                `paid` is what the pay weeks recorded as paid, `toPay` what is left;
 *  - Materials = what the deliveries cost (Materials › Delivery log); `planned` is the preset cost of all ordered;
 *  - Equipment = hire charged to this site so far (Equipment › hire in all);
 *  - General   = General expenses (General tab).
 * Nothing outside those sections is counted (no work items' old "paid", no old stock, no labour/material expenses).
 */
export interface ProjectSpend {
    labour: { attendance: number; contract: number; total: number; paid: number; toPay: number };
    material: { deliveries: number; total: number; planned: number };
    equipment: number;
    general: number;
    total: number;
}

const empty = (): ProjectSpend => ({
    labour: { attendance: 0, contract: 0, total: 0, paid: 0, toPay: 0 },
    material: { deliveries: 0, total: 0, planned: 0 },
    equipment: 0,
    general: 0,
    total: 0,
});

/** For many projects in one round of queries (the project cards), or one (the Overview) */
export async function spendByProject(projectIds: string[]): Promise<Map<string, ProjectSpend>> {
    const out = new Map(projectIds.map((id) => [id, empty()]));
    if (projectIds.length === 0) return out;
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

    for (const r of attendance) out.get(r.projectId)!.labour.attendance = num(r._sum.totalAmount);
    for (const r of contract) out.get(r.projectId)!.labour.contract = num(r._sum.amount);
    for (const r of payments) out.get(r.projectId)!.labour.paid = num(r._sum.amount);
    for (const r of deliveries) out.get(r.projectId)!.material.deliveries = num(r._sum.amount);
    for (const r of planned) out.get(r.projectId)!.material.planned = num(r._sum.amount);
    for (const r of general) out.get(r.projectId)!.general = num(r._sum.amount);
    for (const [id, v] of hire) out.get(id)!.equipment = v;

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
export async function projectSpend(userId: string, projectId: string): Promise<ProjectSpend> {
    await requireCan(userId, "project.view");
    return (await spendByProject([projectId])).get(projectId)!;
}