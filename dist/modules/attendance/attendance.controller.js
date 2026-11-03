import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { toDay } from "../../lib/dates.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { diffFields, hasChanges } from "../audit/audit.diff.js";
import { recordAudit } from "../audit/audit.service.js";
import { attendanceDto, toDate } from "./attendance.mapper.js";
import { emptyDays, workersOn } from "./attendance.days.js";
import { listQuerySchema, tradesQuerySchema } from "./atttendance.schema.js";
import { canonicalTrade, DEFAULT_TRADES, tradeSummaries, usualTrade } from "./attendance.trades.js";
import { dayKeyIn } from "../punches/punch.calc.js";
const include = {
    project: { select: { id: true, title: true } },
    workers: { orderBy: { position: "asc" } },
};
const uid = (req) => req.user.sub;
/** The trades already used on a project, so "civil" typed today lands on the existing "Civil" */
async function tradeFor(projectId, raw) {
    if (!raw.trim())
        return "";
    const used = await prisma.attendance.findMany({ where: { projectId, trade: { not: "" } }, distinct: ["trade"], select: { trade: true } });
    return canonicalTrade(raw, [...used.map((u) => u.trade), ...DEFAULT_TRADES]);
}
/** The client's total is never trusted: it is recomputed from the amounts (exact decimal maths) */
const computeTotal = (workers, extras) => workers.reduce((sum, w) => sum.plus(w.amount), new Prisma.Decimal(extras));
const workerRows = (workers) => workers.map((w, position) => ({ label: w.label, amount: w.amount, position }));
/** Which attendance records this person may see: access is company-wide, so it is one project or all of them */
async function visibleScope(userId, projectId) {
    if (projectId) {
        await requirePermission(userId, projectId, "attendance.view");
        return { projectId };
    }
    await requireCan(userId, "attendance.view");
    return {};
}
/** Newest first, with search and server-side pagination. Without projectId it returns recent records across your projects. */
export async function list(req, res) {
    const { projectId, q, trade, page, pageSize } = listQuerySchema.parse(req.query);
    const search = q
        ? { OR: [{ contractorName: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } }] }
        : {};
    const byTrade = trade === undefined ? {} : { trade: trade === "-" ? "" : trade };
    const where = { AND: [await visibleScope(uid(req), projectId), search, byTrade] };
    const [items, total] = await prisma.$transaction([
        prisma.attendance.findMany({
            where,
            include,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }], // id breaks ties so pages never repeat or skip a row
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.attendance.count({ where }),
    ]);
    res.json({ items: items.map(attendanceDto), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}
export async function create(req, res) {
    const userId = uid(req);
    const { projectId, contractorName, date, workers, extras, notes } = req.body;
    await requirePermission(userId, projectId, "attendance.write");
    const trade = await tradeFor(projectId, req.body.trade);
    const record = await prisma.$transaction(async (tx) => {
        const created = await tx.attendance.create({
            data: {
                ownerId: userId, // who entered it
                projectId,
                contractorName,
                trade,
                date: toDate(date),
                extras,
                notes,
                totalAmount: computeTotal(workers, extras),
                workers: { create: workerRows(workers) },
            },
            include,
        });
        const total = created.totalAmount.toNumber();
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "attendance.created",
            entityType: "attendance",
            entityId: created.id,
            summary: `Added attendance entry for ${contractorName}${trade ? ` (${trade})` : ""} on ${date}: total ${total}`,
            changes: { totalAmount: { from: null, to: total } },
        });
        return created;
    });
    res.status(201).json({ attendance: attendanceDto(record) });
}
/**
 * Several days at once: one entry per day, so each day still has its own slip, can be edited or deleted on its own,
 * and is counted on its own date. Each labourer can have a different amount on each day. All are saved together or
 * none are.
 */
export async function createMany(req, res) {
    const userId = uid(req);
    const { projectId, contractorName, dates, workers, extras, notes } = req.body;
    await requirePermission(userId, projectId, "attendance.write");
    const trade = await tradeFor(projectId, req.body.trade);
    const days = [...dates].sort();
    const empty = emptyDays(workers, days, extras);
    if (empty.length)
        throw new HttpError(400, `Nothing is paid on ${empty.join(", ")}. Enter the amounts for ${empty.length === 1 ? "that day" : "those days"}, or remove ${empty.length === 1 ? "it" : "them"}.`);
    // Everything is built in memory first, then written with two bulk inserts. The number of queries stays the same
    // whether it is 2 days or 62. Saving day by day used to run many queries in one transaction, which a slow or
    // distant database could not finish in time (500: "Transaction already closed").
    let total = new Prisma.Decimal(0);
    const entries = days.map((date) => {
        const onDay = workersOn(workers, date);
        const dayTotal = computeTotal(onDay, extras);
        total = total.plus(dayTotal);
        return { id: randomUUID(), date, onDay, dayTotal };
    });
    const firstDay = days[0] ?? "";
    const lastDay = days[days.length - 1] ?? "";
    await prisma.$transaction(async (tx) => {
        await tx.attendance.createMany({
            data: entries.map((e) => ({
                id: e.id,
                ownerId: userId,
                projectId,
                contractorName,
                trade,
                date: toDate(e.date),
                extras,
                notes,
                totalAmount: e.dayTotal,
            })),
        });
        await tx.attendanceWorker.createMany({
            data: entries.flatMap((e) => workerRows(e.onDay).map((w) => ({ ...w, attendanceId: e.id }))),
        });
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "attendance.created",
            entityType: "attendance",
            entityId: entries[0]?.id ?? null,
            summary: `Added attendance for ${contractorName} on ${days.length} days (${firstDay} to ${lastDay}): total ${total.toNumber()}`,
            changes: { totalAmount: { from: null, to: total.toNumber() }, days: { from: null, to: days.join(", ") } },
        });
    }, { maxWait: 10_000, timeout: 30_000 });
    const records = await prisma.attendance.findMany({
        where: { id: { in: entries.map((e) => e.id) } },
        include,
        orderBy: { date: "asc" },
    });
    res.status(201).json({ attendance: records.map(attendanceDto), count: records.length });
}
export async function update(req, res) {
    const userId = uid(req);
    const { id } = req.params;
    const { contractorName, date, workers, extras, notes } = req.body;
    const before = await prisma.attendance.findUnique({ where: { id } });
    if (!before)
        throw new HttpError(404, "Record not found");
    await requirePermission(userId, before.projectId, "attendance.write");
    const trade = req.body.trade === undefined ? before.trade : await tradeFor(before.projectId, req.body.trade);
    // One statement: replace the workers and update the record together (atomic)
    const record = await prisma.$transaction(async (tx) => {
        const updated = await tx.attendance.update({
            where: { id },
            data: {
                contractorName,
                trade,
                date: toDate(date),
                extras,
                notes,
                totalAmount: computeTotal(workers, extras),
                workers: { deleteMany: {}, create: workerRows(workers) },
            },
            include,
        });
        const facts = (r) => ({
            contractorName: r.contractorName,
            trade: r.trade,
            date: toDay(r.date),
            extras: r.extras.toNumber(),
            totalAmount: r.totalAmount.toNumber(),
        });
        const changes = diffFields(facts(before), facts(updated), ["contractorName", "trade", "date", "extras", "totalAmount"]);
        if (hasChanges(changes)) {
            await recordAudit(tx, {
                projectId: before.projectId,
                actorId: userId,
                action: "attendance.updated",
                entityType: "attendance",
                entityId: id,
                summary: `Edited attendance entry for ${contractorName} on ${date}`,
                changes,
            });
        }
        return updated;
    });
    res.json({ attendance: attendanceDto(record) });
}
/** Deleting a payment record needs a manager, not just someone who may enter attendance */
export async function remove(req, res) {
    const userId = uid(req);
    const { id } = req.params;
    const before = await prisma.attendance.findUnique({ where: { id } });
    if (!before)
        throw new HttpError(404, "Record not found");
    await requirePermission(userId, before.projectId, "project.manage");
    await prisma.$transaction(async (tx) => {
        await tx.attendance.delete({ where: { id } }); // workers are removed by the database (onDelete: Cascade)
        await recordAudit(tx, {
            projectId: before.projectId,
            actorId: userId,
            action: "attendance.deleted",
            entityType: "attendance",
            entityId: id,
            summary: `Deleted attendance entry for ${before.contractorName} on ${toDay(before.date)}: total ${before.totalAmount.toNumber()}`,
            changes: { totalAmount: { from: before.totalAmount.toNumber(), to: null } },
        });
    });
    res.status(204).end();
}
/* ---------------------------------- trades ---------------------------------- */
/**
 * GET /attendance/trades?projectId=…: one card per trade (all time, the last 7 days, this month, who works in it),
 * the trades to offer on the form, and each contractor's usual trade so the form can fill it in.
 */
export async function trades(req, res) {
    const { projectId } = tradesQuerySchema.parse(req.query);
    await requirePermission(uid(req), projectId, "attendance.view");
    const today = dayKeyIn(new Date());
    const weekFrom = toDate(new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10));
    const monthFrom = toDate(`${today.slice(0, 7)}-01`);
    const sumBy = (from) => prisma.attendance.groupBy({ by: ["trade"], where: { projectId, ...(from ? { date: { gte: from } } : {}) }, _sum: { totalAmount: true }, _count: { _all: true }, _max: { date: true } });
    const [all, week, month, people, recent] = await Promise.all([
        sumBy(),
        sumBy(weekFrom),
        sumBy(monthFrom),
        prisma.attendance.findMany({ where: { projectId }, distinct: ["trade", "contractorName"], select: { trade: true, contractorName: true } }),
        prisma.attendance.findMany({ where: { projectId, trade: { not: "" } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500, select: { contractorName: true, trade: true } }),
    ]);
    const total = (g) => g._sum.totalAmount?.toNumber() ?? 0;
    const used = all.map((g) => g.trade).filter(Boolean);
    res.json({
        trades: tradeSummaries(all.map((g) => ({ trade: g.trade, entries: g._count._all, total: total(g), lastDate: g._max.date ? toDay(g._max.date) : null })), week.map((g) => ({ trade: g.trade, total: total(g) })), month.map((g) => ({ trade: g.trade, total: total(g) })), people),
        choices: [...used, ...DEFAULT_TRADES.filter((d) => !used.some((u) => u.toLowerCase() === d.toLowerCase()))],
        usual: usualTrade(recent),
    });
}
/** PATCH /attendance/trade: give a contractor's entries a trade in one go (the one-time sort of old entries) */
export async function setTrade(req, res) {
    const userId = uid(req);
    const { projectId, contractorName, all } = req.body;
    await requirePermission(userId, projectId, "attendance.write");
    const trade = await tradeFor(projectId, req.body.trade);
    const updated = await prisma.$transaction(async (tx) => {
        const r = await tx.attendance.updateMany({ where: { projectId, contractorName, ...(all ? {} : { trade: "" }) }, data: { trade } });
        if (r.count > 0) {
            await recordAudit(tx, {
                projectId,
                actorId: userId,
                action: "attendance.trade_set",
                entityType: "attendance",
                entityId: projectId,
                summary: `Put ${r.count} ${r.count === 1 ? "entry" : "entries"} of ${contractorName} under ${trade}`,
            });
        }
        return r.count;
    });
    res.json({ updated, trade });
}
//# sourceMappingURL=attendance.controller.js.map