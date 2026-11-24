import { prisma } from "../../lib/prisma.js";
import { requireCan } from "../../lib/projectAccess.js";
import { equipmentSpendByProject } from "../equipment/equipment.service.js";
import { purchaseTotalsByProject } from "../material-purchases/materialPurchases.service.js";

const num = (v: { toNumber(): number } | null | undefined) => v?.toNumber() ?? 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What a project has actually spent, taken only from the workspace sections, so the Overview, the Expenditure tab and
 * the project cards add up to exactly what those sections show. Anything archived counts nowhere, as in the sections.
 *  - Labour    = per person (team head, one person or subcontractor), what they are owed or what they were paid,
 *                whichever is more. Owed = their bills (Attendance › a person's Payments) when they have any, otherwise
 *                what they earned: attendance (Attendance amount) + contract work done till date (Subcontract › Work
 *                done). So nothing counts twice, and a payment made without attendance marked still counts.
 *                `paid` = every payment in the Labour tabs; `toPay` = what people are still owed (each To pay above 0);
 *                `ahead` = what was paid beyond what is owed (each "Paid ahead");
 *  - Materials = what the deliveries cost (Materials › Spent so far); `planned` = Materials › Planned cost;
 *  - Equipment = owned items at this site × cost each, plus hire charged for hired items (Equipment tab);
 *  - General   = General expenses (General tab › In all).
 * Nothing outside those sections is counted (no work items' old "paid", no old stock, no labour/material expenses).
 */
export interface ProjectSpend {
    /** total = earned (attendance + contract); spent = per person the larger of earned and paid (what Spent so far uses) */
    labour: { attendance: number; contract: number; total: number; billed: number; paid: number; toPay: number; ahead: number; spent: number };
    material: { deliveries: number; total: number; planned: number };
    equipment: number;
    general: number;
    total: number;
}

const empty = (): ProjectSpend => ({
    labour: { attendance: 0, contract: 0, total: 0, billed: 0, paid: 0, toPay: 0, ahead: 0, spent: 0 },
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
    const [attendance, contract, payments, bills, materials, general, equipment] = await Promise.all([
        // per person, so earned and paid can be set against each other
        prisma.attendance.groupBy({ by: ["projectId", "contractorName"], where: live, _sum: { totalAmount: true } }),
        prisma.labourMeasure.groupBy({ by: ["projectId", "contractorName"], where: live, _sum: { amount: true } }),
        prisma.contractorPayment.groupBy({ by: ["projectId", "contractorName"], where: live, _sum: { amount: true } }),
        prisma.labourBill.groupBy({ by: ["projectId", "contractorName"], where: live, _sum: { amount: true }, _count: { _all: true } }),
        purchaseTotalsByProject(projectIds), // the Materials tab's own totals (archived materials and deliveries left out)
        prisma.expense.groupBy({ by: ["projectId"], where: { ...where, category: "general" }, _sum: { amount: true } }),
        equipmentSpendByProject(projectIds),
    ]);

    // Each person by name (capitals and spaces ignored), as the Labour tabs list them
    const people = new Map<string, Map<string, { earned: number; paid: number; billed: number; bills: number }>>(projectIds.map((id) => [id, new Map()]));
    const person = (projectId: string, name: string) => {
        const list = people.get(projectId)!;
        const k = name.trim().toLowerCase();
        if (!list.has(k)) list.set(k, { earned: 0, paid: 0, billed: 0, bills: 0 });
        return list.get(k)!;
    };
    for (const r of attendance) {
        const v = num(r._sum.totalAmount);
        out.get(r.projectId)!.labour.attendance += v;
        person(r.projectId, r.contractorName).earned += v;
    }
    for (const r of contract) {
        const v = num(r._sum.amount);
        out.get(r.projectId)!.labour.contract += v;
        person(r.projectId, r.contractorName).earned += v;
    }
    for (const r of payments) {
        const v = num(r._sum.amount);
        out.get(r.projectId)!.labour.paid += v;
        person(r.projectId, r.contractorName).paid += v;
    }
    for (const r of bills) {
        const p = person(r.projectId, r.contractorName);
        p.billed += num(r._sum.amount);
        p.bills += r._count._all;
    }
    for (const [id, list] of people) {
        const L = out.get(id)!.labour;
        for (const p of list.values()) {
            const owed = p.bills > 0 ? p.billed : p.earned; // bills when there are any, as the Attendance tab shows
            L.billed += p.billed;
            L.spent += Math.max(owed, p.paid);
            L.toPay += Math.max(0, owed - p.paid);
            L.ahead += Math.max(0, p.paid - owed);
        }
    }
    for (const [id, m] of materials) {
        out.get(id)!.material.deliveries = m.spent;
        out.get(id)!.material.planned = m.planned;
    }
    for (const r of general) out.get(r.projectId)!.general = num(r._sum.amount);
    for (const [id, v] of equipment) out.get(id)!.equipment = v;

    for (const s of out.values()) {
        s.labour.attendance = round2(s.labour.attendance);
        s.labour.contract = round2(s.labour.contract);
        s.labour.paid = round2(s.labour.paid);
        s.labour.total = round2(s.labour.attendance + s.labour.contract);
        s.labour.toPay = round2(s.labour.toPay);
        s.labour.ahead = round2(s.labour.ahead);
        s.labour.billed = round2(s.labour.billed);
        s.labour.spent = round2(s.labour.spent);
        s.material.deliveries = round2(s.material.deliveries);
        s.material.planned = round2(s.material.planned);
        s.material.total = s.material.deliveries;
        s.general = round2(s.general);
        s.total = round2(s.labour.spent + s.material.total + s.equipment + s.general);
    }
    return out;
}

/** GET /projects/:id/spend: anyone who can open the project sees its totals (no line items) */
export async function projectSpend(userId: string, projectId: string): Promise<ProjectSpend> {
    await requireCan(userId, "project.view");
    return (await spendByProject([projectId])).get(projectId)!;
}