import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { amountOf, round2 } from "./materialPurchases.calc.js";
import type { ImportFromEstimate } from "./materialPurchases.schema.js";

/*
 * "From estimate" in Materials: the lines of the project's Material estimates (the simple estimate section: name,
 * unit, quantity, rate) can be brought into Materials in one go, so what arrives is tracked against them. Each line
 * brought in is linked to its material, so the estimate shows it as "in Materials". A material already on the list
 * (same name) is left as it is, so importing twice doesn't double anything.
 */

const VIEW = "materials.view";
const WRITE = "stock.receive";

const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export interface EstimateLine {
    partId: string; // the estimate line's id
    section: string; // the estimate's name: it becomes the material's section heading
    name: string;
    unit: string;
    quantity: number;
    rate: number;
    amount: number;
    imported: boolean; // already brought in from here, or a material with this name is already on the list
}

type Row = { id: string; name: string; unit: string; quantity: { toNumber(): number }; rate: { toNumber(): number }; purchaseId: string | null };

/** The lines worth bringing in (a name and a quantity), in the estimate's order */
function linesOf(estimateName: string, rows: Row[], known: Set<string>): EstimateLine[] {
    return rows
        .filter((r) => r.name.trim() && r.quantity.toNumber() > 0)
        .map((r) => {
            const quantity = r.quantity.toNumber();
            const rate = r.rate.toNumber();
            return {
                partId: r.id,
                section: estimateName.slice(0, 80),
                name: r.name.replace(/\s+/g, " ").trim().slice(0, 120),
                unit: r.unit.trim().slice(0, 30),
                quantity,
                rate,
                amount: amountOf(quantity, rate),
                imported: r.purchaseId !== null || known.has(key(r.name)),
            };
        });
}

/** Names of the materials on the list now (archived ones don't count) */
async function knownNames(projectId: string) {
    const rows = await prisma.materialPurchase.findMany({ where: { projectId, archivedAt: null }, select: { name: true } });
    return new Set<string>(rows.map((r) => key(r.name)));
}

const lineSelect = { id: true, name: true, unit: true, quantity: true, rate: true, purchaseId: true } as const;

/** GET /projects/:projectId/material-purchases/estimate: the project's Material estimates and their lines, newest first */
export async function estimateLines(userId: string, projectId: string) {
    await requirePermission(userId, projectId, VIEW);
    const [estimates, known] = await Promise.all([
        prisma.materialEstimate.findMany({
            where: { projectId },
            orderBy: { updatedAt: "desc" },
            select: { id: true, name: true, lines: { select: lineSelect, orderBy: { position: "asc" } } },
        }),
        knownNames(projectId),
    ]);
    return {
        estimates: estimates.map((e) => ({ id: e.id, title: e.name || "Untitled estimate", lines: linesOf(e.name, e.lines, known) })),
    };
}

/**
 * POST /projects/:projectId/material-purchases/from-estimate { boqId: the estimate's id, partIds: its line ids }: the
 * chosen lines become materials (dated today) with the estimate's quantity and rate, and each line is linked to its
 * material. Lines with the same name and unit become one material; names already on the list are skipped and reported.
 */
export async function importFromEstimate(userId: string, projectId: string, input: ImportFromEstimate) {
    await requirePermission(userId, projectId, WRITE);
    const estimate = await prisma.materialEstimate.findFirst({
        where: { id: input.boqId, projectId },
        select: { id: true, name: true, lines: { select: lineSelect, orderBy: { position: "asc" } } },
    });
    if (!estimate) throw new HttpError(404, "That estimate is no longer there.");

    const known = await knownNames(projectId);
    const wanted = new Set(input.partIds);
    const chosen = linesOf(estimate.name, estimate.lines, known).filter((l) => wanted.has(l.partId));
    if (chosen.length === 0) throw new HttpError(400, "Pick at least one line of the estimate.");

    // Same name twice, same unit: one material with the quantities added together (both lines linked to it).
    // Same name in another unit can't be added up, so it is skipped and reported.
    const merged = new Map<string, EstimateLine & { lineIds: string[] }>();
    const skipped: string[] = [];
    for (const l of chosen) {
        const m = merged.get(key(l.name));
        if (l.imported || (m && key(m.unit) !== key(l.unit))) {
            skipped.push(l.name);
            continue;
        }
        if (!m) merged.set(key(l.name), { ...l, lineIds: [l.partId] });
        else {
            m.quantity = Math.round((m.quantity + l.quantity) * 1000) / 1000;
            m.amount = round2(m.amount + l.amount);
            m.rate = m.quantity > 0 ? round2(m.amount / m.quantity) : m.rate;
            m.lineIds.push(l.partId);
        }
    }
    const toAdd = [...merged.values()];
    const byLine = new Map(chosen.map((l) => [l.partId, l]));
    const date = new Date(`${dayKeyIn(new Date())}T00:00:00Z`);
    const from = estimate.name || "the estimate";

    const count = await prisma.$transaction(async (tx) => {
        for (const m of toAdd) {
            const made = await tx.materialPurchase.create({
                data: { projectId, section: m.section, name: m.name, unit: m.unit, quantity: m.quantity, rate: m.rate, amount: m.amount, date, note: `From estimate: ${from}`.slice(0, 300), addedById: userId },
                select: { id: true },
            });
            // link each line, with what was sent, so the estimate shows it as "in Materials"
            for (const id of m.lineIds) {
                const l = byLine.get(id)!;
                await tx.materialEstimateLine.update({ where: { id }, data: { purchaseId: made.id, sentName: l.name, sentQuantity: l.quantity, sentRate: l.rate } });
            }
        }
        if (toAdd.length)
            await recordAudit(tx, {
                projectId,
                actorId: userId,
                action: "material_purchase.imported",
                entityType: "project",
                entityId: estimate.id,
                summary: `Imported ${toAdd.length} ${toAdd.length === 1 ? "material" : "materials"} from estimate ${from}`,
            });
        return toAdd.length;
    });
    return { added: count, skipped: [...new Set(skipped)] };
}