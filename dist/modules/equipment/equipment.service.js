import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { CATEGORIES, checkMove, lastCondition, onSiteSince, placeKey, stockByPlace, totalOf, trimQty, useByPlace, YARD, } from "./equipment.calc.js";
import { Prisma } from "../../generated/prisma/client.js";
const num = (v) => (v === null ? null : v.toNumber());
const ymd = (d) => d.toISOString().slice(0, 10);
const asDate = (s) => new Date(`${s}T00:00:00Z`);
// const today = () => dayKeyIn(new Date());
const monthStart = (day) => `${day.slice(0, 7)}-01`;
const itemSelect = {
    id: true,
    name: true,
    category: true,
    unit: true,
    code: true,
    ownership: true,
    hireRate: true,
    hirePer: true,
    supplier: true,
    serviceDue: true,
    notes: true,
    retired: true,
    updatedAt: true,
};
const moveSelect = {
    id: true,
    kind: true,
    fromProjectId: true,
    toProjectId: true,
    quantity: true,
    date: true,
    condition: true,
    createdAt: true,
};
const toMove = (m) => ({
    id: m.id,
    kind: m.kind,
    from: m.fromProjectId,
    to: m.toProjectId,
    qty: m.quantity.toNumber(),
    date: ymd(m.date),
    seq: m.createdAt.getTime(),
    condition: m.condition,
});
const termsOf = (i) => ({ ownership: i.ownership === "hired" ? "hired" : "owned", rate: num(i.hireRate), per: i.hirePer === "month" ? "month" : "day" });
const itemDto = (i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    unit: i.unit,
    code: i.code,
    ownership: i.ownership,
    hireRate: num(i.hireRate),
    hirePer: i.hirePer,
    supplier: i.supplier,
    serviceDue: i.serviceDue ? ymd(i.serviceDue) : null,
    notes: i.notes,
    retired: i.retired,
    updatedAt: i.updatedAt,
});
async function projectNames(ids) {
    const list = [...new Set([...ids].filter(Boolean))];
    if (!list.length)
        return new Map();
    const rows = await prisma.project.findMany({ where: { id: { in: list } }, select: { id: true, title: true } });
    return new Map(rows.map((r) => [r.id, r.title]));
}
const placesOf = (at, names) => ({
    yard: at.get(YARD) ?? 0,
    sites: [...at]
        .filter(([p]) => p !== YARD)
        .map(([projectId, qty]) => ({ projectId, title: names.get(projectId) ?? "Removed project", qty }))
        .sort((a, b) => b.qty - a.qty),
});
/* ------------------------------------------- the register ------------------------------------------- */
/** GET /equipment: every item, how many there are and where; plus the projects equipment can be sent to */
export async function listEquipment(userId) {
    await requireCan(userId, "equipment.view");
    const [items, moves, projects] = await Promise.all([
        prisma.equipment.findMany({ select: itemSelect, orderBy: [{ retired: "asc" }, { name: "asc" }] }),
        prisma.equipmentMove.findMany({ select: { ...moveSelect, equipmentId: true } }),
        prisma.project.findMany({ where: { status: "ONGOING" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    ]);
    const byItem = new Map();
    for (const m of moves)
        byItem.set(m.equipmentId, [...(byItem.get(m.equipmentId) ?? []), toMove(m)]);
    const names = await projectNames([...moves.flatMap((m) => [m.fromProjectId ?? "", m.toProjectId ?? ""]), ...projects.map((p) => p.id)]);
    return {
        categories: CATEGORIES,
        projects,
        items: items.map((i) => {
            const at = stockByPlace(byItem.get(i.id) ?? []);
            return { ...itemDto(i), total: totalOf(at), ...placesOf(at, names) };
        }),
    };
}
/** GET /equipment/:id: one item, where it is, what it has cost each site, and every move */
export async function getEquipment(userId, id) {
    await requireCan(userId, "equipment.view");
    const item = await prisma.equipment.findUnique({ where: { id }, select: { ...itemSelect, addedBy: { select: { name: true, email: true } }, createdAt: true } });
    if (!item)
        throw new HttpError(404, "Equipment not found");
    const rows = await prisma.equipmentMove.findMany({
        where: { equipmentId: id },
        select: { ...moveSelect, note: true, by: { select: { name: true, email: true } } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
    const moves = rows.map(toMove);
    const names = await projectNames(rows.flatMap((m) => [m.fromProjectId ?? "", m.toProjectId ?? ""]));
    const at = stockByPlace(moves);
    const day = today();
    const use = useByPlace(moves, termsOf(item), day);
    const month = useByPlace(moves, termsOf(item), day, { from: monthStart(day) });
    return {
        ...itemDto(item),
        addedBy: item.addedBy.name || item.addedBy.email,
        total: totalOf(at),
        ...placesOf(at, names),
        use: [...use]
            .map(([place, u]) => ({
            projectId: place === YARD ? null : place,
            title: place === YARD ? "Yard" : (names.get(place) ?? "Removed project"),
            unitDays: u.unitDays,
            charge: u.charge,
            chargeThisMonth: month.get(place)?.charge ?? 0,
        }))
            .sort((a, b) => b.charge - a.charge || b.unitDays - a.unitDays),
        history: rows.map((m) => ({
            id: m.id,
            kind: m.kind,
            from: m.fromProjectId ? { projectId: m.fromProjectId, title: names.get(m.fromProjectId) ?? "Removed project" } : null,
            to: m.toProjectId ? { projectId: m.toProjectId, title: names.get(m.toProjectId) ?? "Removed project" } : null,
            quantity: m.quantity.toNumber(),
            date: ymd(m.date),
            condition: m.condition,
            note: m.note,
            by: m.by.name || m.by.email,
            createdAt: m.createdAt,
        })),
    };
}
/* ------------------------------------------- one project ------------------------------------------- */
/** GET /projects/:id/equipment: what is at this site now, since when, and what it has cost here */
export async function projectEquipment(userId, projectId) {
    await requirePermission(userId, projectId, "equipment.view");
    const touching = await prisma.equipmentMove.findMany({
        where: { OR: [{ toProjectId: projectId }, { fromProjectId: projectId }] },
        select: { equipmentId: true },
        distinct: ["equipmentId"],
    });
    const ids = touching.map((t) => t.equipmentId);
    const [items, moves] = await Promise.all([
        prisma.equipment.findMany({ where: { id: { in: ids } }, select: itemSelect }),
        prisma.equipmentMove.findMany({ where: { equipmentId: { in: ids } }, select: { ...moveSelect, equipmentId: true } }),
    ]);
    const byItem = new Map();
    for (const m of moves)
        byItem.set(m.equipmentId, [...(byItem.get(m.equipmentId) ?? []), toMove(m)]);
    const day = today();
    const rows = items.map((i) => {
        const list = byItem.get(i.id) ?? [];
        const here = stockByPlace(list).get(projectId) ?? 0;
        const use = useByPlace(list, termsOf(i), day).get(projectId);
        const month = useByPlace(list, termsOf(i), day, { from: monthStart(day) }).get(projectId);
        return {
            ...itemDto(i),
            here,
            since: onSiteSince(list, projectId),
            condition: lastCondition(list, projectId),
            unitDays: use?.unitDays ?? 0,
            hireSoFar: use?.charge ?? 0,
            hireThisMonth: month?.charge ?? 0,
        };
    });
    const now = rows.filter((r) => r.here > 0).sort((a, b) => a.name.localeCompare(b.name));
    const before = rows.filter((r) => r.here <= 0 && r.unitDays > 0).sort((a, b) => b.hireSoFar - a.hireSoFar);
    return {
        categories: CATEGORIES,
        items: now,
        /** Here earlier, gone now: kept so their hire charges still add up on this project */
        earlier: before.map((r) => ({ id: r.id, name: r.name, unit: r.unit, category: r.category, unitDays: r.unitDays, hireSoFar: r.hireSoFar, hireThisMonth: r.hireThisMonth })),
        totals: {
            items: now.length,
            hireSoFar: Math.round(rows.reduce((s, r) => s + r.hireSoFar, 0)),
            hireThisMonth: Math.round(rows.reduce((s, r) => s + r.hireThisMonth, 0)),
            serviceDue: now.filter((r) => r.serviceDue && r.serviceDue <= day).length,
        },
    };
}
/** The hub tile's line: how many items are here, and this month's hire */
export async function equipmentHeadline(projectId) {
    const touching = await prisma.equipmentMove.findMany({ where: { OR: [{ toProjectId: projectId }, { fromProjectId: projectId }] }, select: { equipmentId: true }, distinct: ["equipmentId"] });
    if (!touching.length)
        return { items: 0, hireThisMonth: 0 };
    const ids = touching.map((t) => t.equipmentId);
    const [items, moves] = await Promise.all([
        prisma.equipment.findMany({ where: { id: { in: ids } }, select: itemSelect }),
        prisma.equipmentMove.findMany({ where: { equipmentId: { in: ids } }, select: { ...moveSelect, equipmentId: true } }),
    ]);
    const day = today();
    let count = 0;
    let hire = 0;
    for (const i of items) {
        const list = moves.filter((m) => m.equipmentId === i.id).map(toMove);
        if ((stockByPlace(list).get(projectId) ?? 0) > 0)
            count++;
        hire += useByPlace(list, termsOf(i), day, { from: monthStart(day) }).get(projectId)?.charge ?? 0;
    }
    return { items: count, hireThisMonth: Math.round(hire) };
}
/* ---------------------------------------------- changes ---------------------------------------------- */
async function placeName(db, place) {
    if (place === YARD)
        return "the yard";
    const p = await db.project.findUnique({ where: { id: place }, select: { title: true } });
    return p?.title ?? "that project";
}
async function assertProject(db, id) {
    if (id && !(await db.project.findUnique({ where: { id }, select: { id: true } })))
        throw new HttpError(400, "That project doesn't exist any more.");
}
/** Moves on one item are checked and saved one at a time, so two people can't both send the last 10 plates */
const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10_000 };
export async function createEquipment(userId, input) {
    await requireCan(userId, "equipment.manage");
    if (input.date > today())
        throw new HttpError(400, "The date can't be in the future.");
    return prisma.$transaction(async (tx) => {
        await assertProject(tx, input.to);
        const { quantity, to, date, serviceDue, ...details } = input;
        const item = await tx.equipment.create({
            data: { ...details, serviceDue: serviceDue ? asDate(serviceDue) : null, addedById: userId },
            select: { id: true },
        });
        await tx.equipmentMove.create({
            data: { equipmentId: item.id, kind: "add", toProjectId: to, quantity, date: asDate(date), byId: userId, note: "Added to the register" },
        });
        await recordAudit(tx, {
            projectId: to,
            actorId: userId,
            action: "equipment.added",
            entityType: "equipment",
            entityId: item.id,
            summary: `Added ${trimQty(quantity)} ${input.unit} of ${input.name} at ${await placeName(tx, placeKey(to))}`,
        });
        return item;
    });
}
export async function updateEquipment(userId, id, input) {
    await requireCan(userId, "equipment.manage");
    const before = await prisma.equipment.findUnique({ where: { id }, select: itemSelect });
    if (!before)
        throw new HttpError(404, "Equipment not found");
    const { serviceDue, ...rest } = input;
    await prisma.$transaction(async (tx) => {
        await tx.equipment.update({ where: { id }, data: { ...rest, ...(serviceDue !== undefined ? { serviceDue: serviceDue ? asDate(serviceDue) : null } : {}) } });
        await recordAudit(tx, {
            projectId: null,
            actorId: userId,
            action: "equipment.updated",
            entityType: "equipment",
            entityId: id,
            summary: `Changed the details of ${input.name ?? before.name}`,
        });
    });
    return { id };
}
const KIND_WORDS = { add: "Added", move: "Moved", write_off: "Wrote off" };
/** POST /equipment/:id/moves: bring more in, move between places, or write some off */
export async function addMove(userId, id, input) {
    await requireCan(userId, "equipment.manage");
    const move = {
        kind: input.kind,
        from: input.kind === "add" ? null : input.from,
        to: input.kind === "write_off" ? null : input.to,
        qty: input.quantity,
        date: input.date,
    };
    const saved = await prisma.$transaction(async (tx) => {
        const item = await tx.equipment.findUnique({ where: { id }, select: { name: true, unit: true } });
        if (!item)
            throw new HttpError(404, "Equipment not found");
        await assertProject(tx, move.from);
        await assertProject(tx, move.to);
        const moves = (await tx.equipmentMove.findMany({ where: { equipmentId: id }, select: moveSelect })).map(toMove);
        const names = await projectNames([move.from ?? "", move.to ?? "", ...moves.flatMap((m) => [m.from ?? "", m.to ?? ""])]);
        const name = (p) => (p === YARD ? "the yard" : (names.get(p) ?? "that project"));
        const problem = checkMove(moves, move, today(), name, item.unit);
        if (problem)
            throw new HttpError(400, problem);
        const row = await tx.equipmentMove.create({
            data: {
                equipmentId: id,
                kind: move.kind,
                fromProjectId: move.from,
                toProjectId: move.to,
                quantity: move.qty,
                date: asDate(move.date),
                condition: input.condition,
                note: input.note,
                byId: userId,
            },
            select: { id: true },
        });
        // Using it again: it can't stay retired
        await tx.equipment.update({ where: { id }, data: { retired: false } });
        const where = move.kind === "add" ? `at ${name(placeKey(move.to))}` : move.kind === "write_off" ? `at ${name(placeKey(move.from))}` : `from ${name(placeKey(move.from))} to ${name(placeKey(move.to))}`;
        await recordAudit(tx, {
            projectId: move.to ?? move.from,
            actorId: userId,
            action: `equipment.${move.kind}`,
            entityType: "equipment",
            entityId: id,
            summary: `${KIND_WORDS[move.kind]} ${trimQty(move.qty)} ${item.unit} of ${item.name} ${where}${input.note ? ` (${input.note})` : ""}`,
        });
        return row;
    }, serial);
    return saved;
}
/** DELETE /equipment/:id/moves/:moveId: undo the latest move (a slip of the finger), if nothing later depends on it */
export async function undoMove(userId, id, moveId) {
    await requireCan(userId, "equipment.manage");
    await prisma.$transaction(async (tx) => {
        const rows = await tx.equipmentMove.findMany({ where: { equipmentId: id }, select: { ...moveSelect, note: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
        const latest = rows[0];
        if (!latest || latest.id !== moveId)
            throw new HttpError(400, "Only the latest move can be undone. Record a move back instead.");
        if (rows.length === 1)
            throw new HttpError(400, "This is how the item was added. Write it off instead, or edit its details.");
        await tx.equipmentMove.delete({ where: { id: moveId } });
        const item = await tx.equipment.findUnique({ where: { id }, select: { name: true, unit: true } });
        await recordAudit(tx, {
            projectId: latest.toProjectId ?? latest.fromProjectId,
            actorId: userId,
            action: "equipment.move_undone",
            entityType: "equipment",
            entityId: id,
            summary: `Undid a move of ${trimQty(latest.quantity.toNumber())} ${item?.unit ?? ""} of ${item?.name ?? "equipment"} on ${ymd(latest.date)}`,
        });
    }, serial);
    return { ok: true };
}
//# sourceMappingURL=equipment.service.js.map