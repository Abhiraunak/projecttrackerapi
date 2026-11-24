import { prisma } from "../../lib/prisma.js";
import { requireCan } from "../../lib/projectAccess.js";
import { equipmentSpendByProject } from "../equipment/equipment.service.js";
import { purchaseTotalsByProject } from "../material-purchases/materialPurchases.service.js";

const num = (v: { toNumber(): number } | null | undefined) => v?.toNumber() ?? 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What a project has actually spent, taken only from the workspace sections, so the Overview, the Expenditure tab and
 * the project cards add up to exactly what those sections show. Anything archived counts nowhere, as in the sections.
 *  - Labour    = attendance (Labour › Attendance, Earned) + contract work done till date (Labour › Subcontract, Work done);
 *                `paid` = every payment in the Labour tabs, `toPay` what is left (Attendance To pay + Subcontract To pay);
 *  - Materials = what the deliveries cost (Materials › Spent so far); `planned` = Materials › Planned cost;
 *  - Equipment = owned items at this site × cost each, plus hire charged for hired items (Equipment tab);
 *  - General   = General expenses (General tab › In all).
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

    const live = { ...where, archivedAt: null }; // archived rows count nowhere
    const [attendance, contract, payments, materials, general, equipment] = await Promise.all([
        prisma.attendance.groupBy({ by: ["projectId"], where: live, _sum: { totalAmount: true } }),
        prisma.labourMeasure.groupBy({ by: ["projectId"], where: live, _sum: { amount: true } }),
        prisma.contractorPayment.groupBy({ by: ["projectId"], where: live, _sum: { amount: true } }),
        purchaseTotalsByProject(projectIds), // the Materials tab's own totals (archived materials and deliveries left out)
        prisma.expense.groupBy({ by: ["projectId"], where: { ...where, category: "general" }, _sum: { amount: true } }),
        equipmentSpendByProject(projectIds),
    ]);

    for (const r of attendance) out.get(r.projectId)!.labour.attendance = num(r._sum.totalAmount);
    for (const r of contract) out.get(r.projectId)!.labour.contract = num(r._sum.amount);
    for (const r of payments) out.get(r.projectId)!.labour.paid = num(r._sum.amount);
    for (const [id, m] of materials) {
        out.get(id)!.material.deliveries = m.spent;
        out.get(id)!.material.planned = m.planned;
    }
    for (const r of general) out.get(r.projectId)!.general = num(r._sum.amount);
    for (const [id, v] of equipment) out.get(id)!.equipment = v;

    for (const s of out.values()) {
        s.labour.total = round2(s.labour.attendance + s.labour.contract);
        s.labour.toPay = round2(s.labour.total - s.labour.paid); // below 0: paid in advance
        s.material.deliveries = round2(s.material.deliveries);
        s.material.planned = round2(s.material.planned);
        s.material.total = s.material.deliveries;
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