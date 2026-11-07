import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { canonicalTrade, DEFAULT_TRADES } from "../attendance/attendance.trades.js";
import { canonicalName } from "../contractor-payments/contractor-payments.calc.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { addDays, lineKey, measureAmount, monthLines, weekLines, weekStartOf, weeksOf, ymdOf } from "./labour-weeks.calc.js";
/*
 * The labour pay week (Monday to Sunday), contract work measurements, the month for every contractor, and labour
 * search. Seeing needs "View attendance"; logging work needs "Enter attendance"; settling a week, reopening one and
 * deleting a measurement need "Create and edit projects".
 */
const day = (ymd) => new Date(`${ymd}T00:00:00Z`);
const num = (d) => d?.toNumber() ?? 0;
const today = () => dayKeyIn(new Date());
const whoIs = async (userId) => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    return u?.name || u?.email || "Someone";
};
/* ------------------------------------------------ the week ------------------------------------------------ */
/** GET /projects/:id/labour/week?start=YYYY-MM-DD (any day of the week; this week when left out) */
export async function weekView(userId, projectId, anyDay) {
    await requirePermission(userId, projectId, "attendance.view");
    const start = weekStartOf(anyDay ?? today());
    const end = addDays(start, 6);
    const before = { projectId, date: { lt: day(start) } };
    const during = { projectId, date: { gte: day(start), lte: day(end) } };
    const [attBefore, conBefore, paidBefore, attWeek, measures, payments, settled] = await Promise.all([
        prisma.attendance.groupBy({ by: ["trade", "contractorName"], where: before, _sum: { totalAmount: true } }),
        prisma.labourMeasure.groupBy({ by: ["trade", "contractorName"], where: before, _sum: { amount: true } }),
        prisma.contractorPayment.groupBy({ by: ["trade", "contractorName"], where: before, _sum: { amount: true } }),
        prisma.attendance.groupBy({ by: ["trade", "contractorName", "date"], where: during, _sum: { totalAmount: true }, _count: { _all: true } }),
        prisma.labourMeasure.findMany({ where: during, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
        prisma.contractorPayment.findMany({ where: during, orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { id: true, trade: true, contractorName: true, date: true, amount: true, remark: true } }),
        prisma.labourWeek.findMany({ where: { projectId, weekStart: day(start) } }),
    ]);
    const money = (rows, field) => rows.map((r) => ({ trade: r.trade, contractorName: r.contractorName, amount: num(r._sum[field]) }));
    const { lines, totals } = weekLines({
        start,
        attendanceBefore: money(attBefore, "totalAmount"),
        contractBefore: money(conBefore, "amount"),
        paidBefore: money(paidBefore, "amount"),
        attendanceThisWeek: attWeek.map((r) => ({ trade: r.trade, contractorName: r.contractorName, date: ymdOf(r.date), amount: num(r._sum.totalAmount) })),
        contractThisWeek: measures.map((m) => ({ trade: m.trade, contractorName: m.contractorName, date: ymdOf(m.date), amount: num(m.amount) })),
        paidThisWeek: payments.map((p) => ({ trade: p.trade, contractorName: p.contractorName, date: ymdOf(p.date), amount: num(p.amount) })),
        settled: settled.map((s) => ({ trade: s.trade, contractorName: s.contractorName, settledAt: s.settledAt.toISOString(), settledBy: s.settledBy })),
    });
    // Each line's own payments and measurements, for the card
    const of = (r) => lineKey(r.trade, r.contractorName);
    return {
        start,
        end,
        today: today(),
        lines: lines.map((l) => ({
            ...l,
            payments: payments.filter((p) => of(p) === l.key).map((p) => ({ id: p.id, date: ymdOf(p.date), amount: num(p.amount), remark: p.remark })),
            measures: measures.filter((m) => of(m) === l.key).map(measureDto),
        })),
        totals,
    };
}
/** POST /projects/:id/labour/week/settle: close one contractor's week. Attendance and contract work in it are locked. */
export async function settleWeek(userId, projectId, input) {
    await requirePermission(userId, projectId, "project.manage");
    const start = weekStartOf(input.start);
    if (start > today())
        throw new HttpError(400, "That week hasn't started yet.");
    const by = await whoIs(userId);
    const contractorKey = lineKey(input.trade, input.contractorName);
    const row = await prisma.$transaction(async (tx) => {
        const saved = await tx.labourWeek.upsert({
            where: { projectId_contractorKey_weekStart: { projectId, contractorKey, weekStart: day(start) } },
            create: { projectId, trade: input.trade, contractorName: input.contractorName, contractorKey, weekStart: day(start), settledBy: by },
            update: {},
        });
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "labour_week.settled",
            entityType: "project",
            entityId: saved.id,
            summary: `Settled the week of ${start} for ${input.contractorName}${input.trade ? ` (${input.trade})` : ""}`,
        });
        return saved;
    });
    return { ok: true, start, settledAt: row.settledAt.toISOString(), settledBy: row.settledBy };
}
/** DELETE /projects/:id/labour/week/settle: reopen a settled week, to correct its attendance */
export async function reopenWeek(userId, projectId, input) {
    await requirePermission(userId, projectId, "project.manage");
    const start = weekStartOf(input.start);
    const contractorKey = lineKey(input.trade, input.contractorName);
    await prisma.$transaction(async (tx) => {
        const { count } = await tx.labourWeek.deleteMany({ where: { projectId, contractorKey, weekStart: day(start) } });
        if (count)
            await recordAudit(tx, {
                projectId,
                actorId: userId,
                action: "labour_week.reopened",
                entityType: "project",
                entityId: null,
                summary: `Reopened the week of ${start} for ${input.contractorName}${input.trade ? ` (${input.trade})` : ""}`,
            });
    });
    return { ok: true, start };
}
/**
 * Throws 409 when any of these days falls in a week already settled for this contractor and trade. Attendance and
 * contract work call it before every change, so a paid week can't change behind the payment.
 */
export async function assertWeeksOpen(projectId, trade, contractorName, days) {
    const weeks = weeksOf(days);
    if (weeks.length === 0)
        return;
    const closed = await prisma.labourWeek.findFirst({
        where: { projectId, contractorKey: lineKey(trade, contractorName), weekStart: { in: weeks.map(day) } },
        select: { weekStart: true },
    });
    if (closed)
        throw new HttpError(409, `The week of ${ymdOf(closed.weekStart)} is settled for ${contractorName}. Reopen that week on the Labour page to change it, or enter this in the current week.`);
}
const measureDto = (m) => ({
    id: m.id,
    trade: m.trade,
    contractorName: m.contractorName,
    date: ymdOf(m.date),
    weekStart: weekStartOf(ymdOf(m.date)),
    work: m.work,
    quantity: m.quantity.toNumber(),
    unit: m.unit,
    rate: m.rate.toNumber(),
    amount: m.amount.toNumber(),
    note: m.note,
    addedBy: m.addedBy,
    createdAt: m.createdAt.toISOString(),
});
/** Names and trades spelled as already used on the project, so the week and the ledger line up */
async function canonical(projectId, input) {
    const [a, p, m] = await Promise.all([
        prisma.attendance.findMany({ where: { projectId }, distinct: ["trade", "contractorName"], select: { trade: true, contractorName: true } }),
        prisma.contractorPayment.findMany({ where: { projectId }, distinct: ["trade", "contractorName"], select: { trade: true, contractorName: true } }),
        prisma.labourMeasure.findMany({ where: { projectId }, distinct: ["trade", "contractorName"], select: { trade: true, contractorName: true } }),
    ]);
    const known = [...a, ...p, ...m];
    return {
        trade: input.trade ? canonicalTrade(input.trade, [...known.map((k) => k.trade).filter(Boolean), ...DEFAULT_TRADES]) : "",
        contractorName: canonicalName(input.contractorName, known.map((k) => k.contractorName)),
    };
}
/** GET /projects/:id/labour/measures: every measurement, newest first, plus the units in use */
export async function listMeasures(userId, projectId) {
    await requirePermission(userId, projectId, "attendance.view");
    const [rows, settled] = await Promise.all([
        prisma.labourMeasure.findMany({ where: { projectId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1000 }),
        prisma.labourWeek.findMany({ where: { projectId }, select: { contractorKey: true, weekStart: true } }),
    ]);
    const closed = new Set(settled.map((s) => `${s.contractorKey}@${ymdOf(s.weekStart)}`));
    const items = rows.map((r) => {
        const d = measureDto(r);
        return { ...d, locked: closed.has(`${lineKey(d.trade, d.contractorName)}@${d.weekStart}`) };
    });
    const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    return { items, total, units: [...new Set(["sqft", "rft", "sqm", "cum", "nos", ...items.map((i) => i.unit)])] };
}
export async function addMeasure(userId, projectId, input) {
    await requirePermission(userId, projectId, "attendance.write");
    if (input.date > today())
        throw new HttpError(400, "The date can't be in the future.");
    const names = await canonical(projectId, input);
    await assertWeeksOpen(projectId, names.trade, names.contractorName, [input.date]);
    const amount = measureAmount(input.quantity, input.rate);
    const addedBy = await whoIs(userId);
    const row = await prisma.$transaction(async (tx) => {
        const created = await tx.labourMeasure.create({
            data: { projectId, ...names, date: day(input.date), work: input.work, quantity: input.quantity, unit: input.unit, rate: input.rate, amount, note: input.note, addedBy },
        });
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "labour_measure.added",
            entityType: "project",
            entityId: created.id,
            summary: `Contract work for ${names.contractorName}: ${input.work}, ${input.quantity} ${input.unit} × ${input.rate} = ${amount} on ${input.date}`,
        });
        return created;
    });
    return { measure: measureDto(row) };
}
export async function updateMeasure(userId, projectId, measureId, input) {
    await requirePermission(userId, projectId, "attendance.write");
    const before = await prisma.labourMeasure.findFirst({ where: { id: measureId, projectId } });
    if (!before)
        throw new HttpError(404, "That measurement was not found.");
    if (input.date > today())
        throw new HttpError(400, "The date can't be in the future.");
    const names = await canonical(projectId, input);
    await assertWeeksOpen(projectId, before.trade, before.contractorName, [ymdOf(before.date)]);
    await assertWeeksOpen(projectId, names.trade, names.contractorName, [input.date]);
    const amount = measureAmount(input.quantity, input.rate);
    const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.labourMeasure.update({
            where: { id: measureId },
            data: { ...names, date: day(input.date), work: input.work, quantity: input.quantity, unit: input.unit, rate: input.rate, amount, note: input.note },
        });
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "labour_measure.updated",
            entityType: "project",
            entityId: measureId,
            summary: `Edited contract work for ${names.contractorName}: ${input.work}, now ${amount}`,
            changes: { amount: { from: num(before.amount), to: amount } },
        });
        return updated;
    });
    return { measure: measureDto(row) };
}
export async function removeMeasure(userId, projectId, measureId) {
    await requirePermission(userId, projectId, "project.manage");
    const before = await prisma.labourMeasure.findFirst({ where: { id: measureId, projectId } });
    if (!before)
        throw new HttpError(404, "That measurement was not found.");
    await assertWeeksOpen(projectId, before.trade, before.contractorName, [ymdOf(before.date)]);
    await prisma.$transaction(async (tx) => {
        await tx.labourMeasure.delete({ where: { id: measureId } });
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "labour_measure.deleted",
            entityType: "project",
            entityId: measureId,
            summary: `Deleted contract work for ${before.contractorName}: ${before.work} (${num(before.amount)})`,
        });
    });
    return { ok: true };
}
/* ------------------------------------------------ the month ------------------------------------------------ */
/** GET /projects/:id/labour/month?month=YYYY-MM: every contractor's month (the "Total" month sheet) */
export async function monthTotals(userId, projectId, month) {
    await requirePermission(userId, projectId, "attendance.view");
    const [y, m] = month.split("-").map(Number);
    const from = day(`${month}-01`);
    const to = new Date(Date.UTC(y, m, 0));
    const where = { projectId, date: { gte: from, lte: to } };
    const [att, con, paid] = await Promise.all([
        prisma.attendance.groupBy({ by: ["trade", "contractorName", "date"], where, _sum: { totalAmount: true } }),
        prisma.labourMeasure.groupBy({ by: ["trade", "contractorName", "date"], where, _sum: { amount: true } }),
        prisma.contractorPayment.groupBy({ by: ["trade", "contractorName", "date"], where, _sum: { amount: true } }),
    ]);
    const dated = (rows, f) => rows.map((r) => ({ trade: r.trade, contractorName: r.contractorName, date: ymdOf(r.date), amount: num(r._sum[f]) }));
    return { month, ...monthLines(month, dated(att, "totalAmount"), dated(con, "amount"), dated(paid, "amount")) };
}
/**
 * GET /projects/:id/labour/search?q=: anything labour on the project that matches: a contractor or team head, a
 * labourer's name, a trade, contract work, a note or a payment remark. Newest first, at most 40.
 */
export async function labourSearch(userId, projectId, q) {
    await requirePermission(userId, projectId, "attendance.view");
    const has = { contains: q, mode: "insensitive" };
    const [att, con, pay] = await Promise.all([
        prisma.attendance.findMany({
            where: { projectId, OR: [{ contractorName: has }, { trade: has }, { notes: has }, { workers: { some: { label: has } } }] },
            orderBy: { date: "desc" },
            take: 20,
            select: { id: true, trade: true, contractorName: true, date: true, totalAmount: true, notes: true, workers: { where: { label: has }, select: { label: true }, take: 3 } },
        }),
        prisma.labourMeasure.findMany({
            where: { projectId, OR: [{ contractorName: has }, { trade: has }, { work: has }, { note: has }] },
            orderBy: { date: "desc" },
            take: 20,
        }),
        prisma.contractorPayment.findMany({
            where: { projectId, OR: [{ contractorName: has }, { trade: has }, { remark: has }] },
            orderBy: { date: "desc" },
            take: 20,
            select: { id: true, trade: true, contractorName: true, date: true, amount: true, remark: true },
        }),
    ]);
    const hits = [
        ...att.map((a) => ({
            kind: "attendance",
            id: a.id,
            title: a.contractorName,
            detail: a.workers.length ? `Attendance · ${a.workers.map((w) => w.label).join(", ")}` : `Attendance${a.notes ? ` · ${a.notes}` : ""}`,
            trade: a.trade,
            contractorName: a.contractorName,
            date: ymdOf(a.date),
            weekStart: weekStartOf(ymdOf(a.date)),
            amount: num(a.totalAmount),
        })),
        ...con.map((m) => ({
            kind: "contract",
            id: m.id,
            title: m.contractorName,
            detail: `Contract work · ${m.work}, ${num(m.quantity)} ${m.unit} × ₹${num(m.rate)}`,
            trade: m.trade,
            contractorName: m.contractorName,
            date: ymdOf(m.date),
            weekStart: weekStartOf(ymdOf(m.date)),
            amount: num(m.amount),
        })),
        ...pay.map((p) => ({
            kind: "payment",
            id: p.id,
            title: p.contractorName,
            detail: `Payment${p.remark ? ` · ${p.remark}` : ""}`,
            trade: p.trade,
            contractorName: p.contractorName,
            date: ymdOf(p.date),
            weekStart: weekStartOf(ymdOf(p.date)),
            amount: num(p.amount),
        })),
    ];
    return { q, hits: hits.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40) };
}
//# sourceMappingURL=labour-weeks.service.js.map