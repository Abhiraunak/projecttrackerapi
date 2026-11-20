import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { partQty, type BoqDocument } from "../boqs/boq.calc.js";
import { amountOf, round2 } from "./materialPurchases.calc.js";
import type { ImportFromEstimate } from "./materialPurchases.schema.js";

/*
 * Materials from the Material estimate (the project's BOQs): every priced line of an estimate (its description,
 * unit, quantity and rate) can be brought into Materials in one go, so what arrives is tracked against it.
 * A material already on the list (same name) is left as it is, so importing twice doesn't double anything.
 */

const VIEW = "materials.view";
const WRITE = "stock.receive";

/** "Providing and laying …" tidied to fit a material name (120 characters, like the form) */
const nameOf = (text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > 120 ? `${t.slice(0, 117).trimEnd()}…` : t;
};
const key = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export interface EstimateLine {
    partId: string;
    section: string; // the estimate's section title: "EARTHWORK", "FLOORING"…
    name: string;
    unit: string;
    quantity: number;
    rate: number;
    amount: number;
    imported: boolean; // a material with this name is already on the list
}

/** Every priced line of one estimate, in its own order. Lines with no quantity or no name are left out. */
function linesOf(doc: BoqDocument, known: Set<string>): EstimateLine[] {
    const out: EstimateLine[] = [];
    for (const sheet of doc.sheets ?? [])
        for (const section of sheet.sections ?? [])
            for (const entry of section.entries ?? []) {
                if (entry.kind !== "item") continue;
                for (const part of entry.parts ?? []) {
                    const quantity = Array.isArray(part.lines) ? Math.round(partQty(part) * 1000) / 1000 : 0;
                    const name = nameOf(part.description || entry.description);
                    if (!name || quantity <= 0) continue;
                    const rate = part.rate ?? 0;
                    out.push({
                        partId: part.id,
                        section: nameOf(section.title).slice(0, 80),
                        name,
                        unit: (part.unit ?? "").trim().slice(0, 30),
                        quantity,
                        rate,
                        amount: amountOf(quantity, rate),
                        imported: known.has(key(name)),
                    });
                }
            }
    return out;
}

async function knownNames(projectId: string) {
    const rows = await prisma.materialPurchase.findMany({ where: { projectId }, select: { name: true } });
    return new Set<string>(rows.map((r) => key(r.name)));
}

/** GET /projects/:projectId/material-purchases/estimate: the project's estimates and their lines, newest first */
export async function estimateLines(userId: string, projectId: string) {
    await requirePermission(userId, projectId, VIEW);
    const [boqs, known] = await Promise.all([
        prisma.boq.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, subtitle: true, boqNumber: true, document: true } }),
        knownNames(projectId),
    ]);
    return {
        estimates: boqs.map((b) => ({
            id: b.id,
            title: [b.title, b.subtitle].filter(Boolean).join(" · ") || b.boqNumber || "Untitled estimate",
            lines: linesOf(b.document as unknown as BoqDocument, known),
        })),
    };
}

/**
 * POST /projects/:projectId/material-purchases/from-estimate { boqId, partIds }: the chosen lines become materials
 * (dated today), with the estimate's quantity and rate. Lines with the same name are added together; names already
 * on the list are skipped and reported back.
 */
export async function importFromEstimate(userId: string, projectId: string, input: ImportFromEstimate) {
    await requirePermission(userId, projectId, WRITE);
    const boq = await prisma.boq.findFirst({ where: { id: input.boqId, projectId }, select: { id: true, title: true, boqNumber: true, document: true } });
    if (!boq) throw new HttpError(404, "That estimate isn't linked to this project any more.");

    const known = await knownNames(projectId);
    const wanted = new Set(input.partIds);
    const chosen = linesOf(boq.document as unknown as BoqDocument, known).filter((l) => wanted.has(l.partId));
    if (chosen.length === 0) throw new HttpError(400, "Pick at least one line of the estimate.");

    // Same name twice in the estimate, same unit: one material with the quantities added together.
    // Same name in another unit can't be added up, so it is skipped and reported.
    const merged = new Map<string, EstimateLine>();
    const skipped: string[] = [];
    for (const l of chosen) {
        const m = merged.get(key(l.name));
        if (l.imported || (m && key(m.unit) !== key(l.unit))) {
            skipped.push(l.name);
            continue;
        }
        if (!m) merged.set(key(l.name), { ...l });
        else {
            m.quantity = Math.round((m.quantity + l.quantity) * 1000) / 1000;
            m.amount = round2(m.amount + l.amount);
            m.rate = m.quantity > 0 ? round2(m.amount / m.quantity) : m.rate;
        }
    }
    const toAdd = [...merged.values()];
    const date = new Date(`${dayKeyIn(new Date())}T00:00:00Z`);
    const from = boq.title || boq.boqNumber || "the estimate";

    const count = await prisma.$transaction(async (tx) => {
        if (toAdd.length) {
            await tx.materialPurchase.createMany({
                data: toAdd.map((l) => ({ projectId, section: l.section, name: l.name, unit: l.unit, quantity: l.quantity, rate: l.rate, amount: l.amount, date, note: `From estimate: ${from}`.slice(0, 300), addedById: userId })),
            });
            await recordAudit(tx, {
                projectId,
                actorId: userId,
                action: "material_purchase.imported",
                entityType: "project",
                entityId: boq.id,
                summary: `Imported ${toAdd.length} ${toAdd.length === 1 ? "material" : "materials"} from estimate ${from}`,
            });
        }
        return toAdd.length;
    });
    return { added: count, skipped: [...new Set(skipped)] };
}