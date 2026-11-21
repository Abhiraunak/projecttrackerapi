import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { dayKeyIn } from "../punches/punch.calc.js";
/*
 * The simple Material estimate in a project: named lists of materials (unit, quantity, rate). "Send to Materials" puts
 * each line in the Materials tab (under the estimate's name as its section) and, for a line sent before and changed
 * since, replaces that material's quantity and rate there. Deliveries already logged are never touched.
 * Seeing and editing needs the BOQ tick; sending also needs "Receive stock" (it writes to Materials).
 */
const USE = "boq.use";
const WRITE_MATERIALS = "stock.receive";
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const num = (v) => (v === null ? null : v.toNumber());
const lineSelect = {
    id: true,
    position: true,
    name: true,
    unit: true,
    quantity: true,
    rate: true,
    purchaseId: true,
    sentName: true,
    sentQuantity: true,
    sentRate: true,
};
/** "new": not in Materials (or removed from there); "sent": in Materials as it is here; "changed": edited since it was sent */
function statusOf(l) {
    if (!l.purchaseId)
        return "new";
    const same = l.sentName === l.name && num(l.sentQuantity) === l.quantity.toNumber() && num(l.sentRate) === l.rate.toNumber();
    return same ? "sent" : "changed";
}
const lineDto = (l) => ({
    id: l.id,
    name: l.name,
    unit: l.unit,
    quantity: l.quantity.toNumber(),
    rate: l.rate.toNumber(),
    amount: r2(l.quantity.toNumber() * l.rate.toNumber()),
    status: statusOf(l),
    /** What was last sent to Materials (null: never, or the material was deleted there), so the page can show "changed" as you type */
    sent: l.purchaseId ? { name: l.sentName ?? "", quantity: num(l.sentQuantity) ?? 0, rate: num(l.sentRate) ?? 0 } : null,
});
/** A line worth sending: it has a name and a quantity */
const ready = (l) => l.name.trim() !== "" && l.quantity.toNumber() > 0;
async function estimateIn(projectId, id) {
    const e = await prisma.materialEstimate.findFirst({ where: { id, projectId }, select: { id: true, name: true, updatedAt: true, lines: { select: lineSelect, orderBy: { position: "asc" } } } });
    if (!e)
        throw new HttpError(404, "That estimate is no longer there.");
    return e;
}
const detail = (e) => {
    const lines = e.lines.map(lineDto);
    return { id: e.id, name: e.name, updatedAt: e.updatedAt, lines, total: r2(lines.reduce((s, l) => s + l.amount, 0)) };
};
/** GET /projects/:projectId/material-estimates: every estimate with its total and how many lines aren't in Materials yet */
export async function listEstimates(userId, projectId) {
    await requirePermission(userId, projectId, USE);
    const rows = await prisma.materialEstimate.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, updatedAt: true, lines: { select: lineSelect } },
    });
    return {
        estimates: rows.map((e) => {
            const lines = e.lines.filter((l) => l.name.trim() !== "");
            return {
                id: e.id,
                name: e.name,
                updatedAt: e.updatedAt,
                lines: lines.length,
                total: r2(lines.reduce((s, l) => s + l.quantity.toNumber() * l.rate.toNumber(), 0)),
                notInMaterials: lines.filter((l) => ready(l) && statusOf(l) !== "sent").length,
            };
        }),
    };
}
export async function getEstimate(userId, projectId, id) {
    await requirePermission(userId, projectId, USE);
    return detail(await estimateIn(projectId, id));
}
/** POST /projects/:projectId/material-estimates: a new estimate with one empty line to type into */
export async function createEstimate(userId, projectId, name) {
    await requirePermission(userId, projectId, USE);
    const e = await prisma.materialEstimate.create({
        data: { projectId, name, createdById: userId, lines: { create: [{ position: 0, name: "", unit: "", quantity: 0, rate: 0 }] } },
        select: { id: true },
    });
    return getEstimate(userId, projectId, e.id);
}
/**
 * PUT /projects/:projectId/material-estimates/:id: save the estimate as it is on screen. Lines that keep their id keep
 * their link to Materials; lines left out are removed (their material stays in Materials); new lines are added.
 * One transaction, so a save is never half done.
 */
export async function saveEstimate(userId, projectId, id, input) {
    await requirePermission(userId, projectId, USE);
    const before = await estimateIn(projectId, id);
    const known = new Set(before.lines.map((l) => l.id));
    const keep = input.lines.filter((l) => l.id && known.has(l.id)).map((l) => l.id);
    await prisma.$transaction(async (tx) => {
        await tx.materialEstimate.update({ where: { id }, data: { name: input.name } });
        await tx.materialEstimateLine.deleteMany({ where: { estimateId: id, id: { notIn: keep } } });
        for (const [position, l] of input.lines.entries()) {
            const data = { position, name: l.name, unit: l.unit, quantity: r3(l.quantity), rate: r2(l.rate) };
            if (l.id && known.has(l.id))
                await tx.materialEstimateLine.update({ where: { id: l.id }, data });
            else
                await tx.materialEstimateLine.create({ data: { ...(l.id ? { id: l.id } : {}), estimateId: id, ...data } }); // the id made by the browser
        }
    });
    return detail(await estimateIn(projectId, id));
}
/** DELETE /projects/:projectId/material-estimates/:id: the estimate goes; materials already sent stay in Materials */
export async function deleteEstimate(userId, projectId, id) {
    await requirePermission(userId, projectId, USE);
    await estimateIn(projectId, id);
    await prisma.materialEstimate.delete({ where: { id } }); // its lines go with it
    return { ok: true };
}
/**
 * POST /projects/:projectId/material-estimates/:id/send: new lines become materials in the Materials tab (section =
 * the estimate's name); changed lines replace their material's name, unit, quantity and rate there. Deliveries are not
 * touched. All in one transaction.
 */
export async function sendToMaterials(userId, projectId, id) {
    await requirePermission(userId, projectId, USE);
    await requirePermission(userId, projectId, WRITE_MATERIALS);
    const e = await estimateIn(projectId, id);
    const todo = e.lines.filter((l) => ready(l) && statusOf(l) !== "sent");
    if (todo.length === 0)
        return { added: 0, updated: 0, estimate: detail(e) };
    const today = new Date(`${dayKeyIn(new Date())}T00:00:00Z`);
    let added = 0;
    let updated = 0;
    await prisma.$transaction(async (tx) => {
        for (const l of todo) {
            const quantity = l.quantity.toNumber();
            const rate = l.rate.toNumber();
            const figures = { name: l.name.trim(), unit: l.unit, quantity, rate, amount: r2(quantity * rate) };
            // a material sent before and still in Materials is updated; otherwise it is added
            const linked = l.purchaseId ? await tx.materialPurchase.findFirst({ where: { id: l.purchaseId, projectId }, select: { id: true } }) : null;
            let purchaseId;
            if (linked) {
                await tx.materialPurchase.update({ where: { id: linked.id }, data: figures });
                purchaseId = linked.id;
                updated += 1;
            }
            else {
                const made = await tx.materialPurchase.create({
                    data: { projectId, section: e.name, ...figures, date: today, note: `From estimate: ${e.name}`, addedById: userId },
                    select: { id: true },
                });
                purchaseId = made.id;
                added += 1;
            }
            await tx.materialEstimateLine.update({ where: { id: l.id }, data: { purchaseId, sentName: l.name, sentQuantity: quantity, sentRate: rate } });
        }
    });
    return { added, updated, estimate: detail(await estimateIn(projectId, id)) };
}
//# sourceMappingURL=materialEstimates.service.js.map