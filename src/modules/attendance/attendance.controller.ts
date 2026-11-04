import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { toDay } from "../../lib/dates.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { diffFields, hasChanges } from "../audit/audit.diff.js";
import { recordAudit } from "../audit/audit.service.js";
import { attendanceDto, toDate } from "./attendance.mapper.js";
import { emptyDaysFor, missingRates, repeatedNames, rowsOn, type DayRow, type PayMode, type PayWorker } from "./attendance.hourly.js";
import { syncTeam } from "./attendance.team.js";
import { listQuerySchema, tradesQuerySchema, type CreateBody, type CreateManyBody, type SetTradeBody, type UpdateBody } from "./atttendance.schema.js";
import { canonicalTrade, DEFAULT_TRADES, tradeSummaries, usualTrade } from "./attendance.trades.js";
import { dayKeyIn } from "../punches/punch.calc.js";

const include = {
  project: { select: { id: true, title: true } },
  workers: { orderBy: { position: "asc" } },
} as const;

const uid = (req: Request<any, any, any, any>) => req.user!.sub;

/** The trades already used on a project, so "civil" typed today lands on the existing "Civil" */
async function tradeFor(projectId: string, raw: string) {
  if (!raw.trim()) return "";
  const used = await prisma.attendance.findMany({ where: { projectId, trade: { not: "" } }, distinct: ["trade"], select: { trade: true } });
  return canonicalTrade(raw, [...used.map((u) => u.trade), ...DEFAULT_TRADES]);
}

/** The client's total is never trusted: it is recomputed from the amounts (exact decimal maths) */
const computeTotal = (workers: { amount: number }[], extras: number) =>
  workers.reduce((sum, w) => sum.plus(w.amount), new Prisma.Decimal(extras));

const workerRows = (workers: (Pick<DayRow, "label" | "amount"> & Partial<DayRow>)[]) =>
  workers.map((w, position) => ({
    label: w.label,
    amount: w.amount,
    position,
    memberId: w.memberId ?? null,
    hours: w.hours ?? null,
    otHours: w.otHours ?? null,
    hourlyRate: w.hourlyRate ?? null,
  }));

/** Paid hourly: everyone who worked needs a day rate, and nobody may be listed twice */
function checkHourly(mode: PayMode, workers: PayWorker[]) {
  const noRate = missingRates(mode, workers);
  if (noRate.length) throw new HttpError(400, `Enter the day rate for ${noRate.join(", ")}.`);
  const twice = repeatedNames(mode, workers);
  if (twice.length) throw new HttpError(400, `${twice.join(", ")} ${twice.length === 1 ? "is" : "are"} listed twice.`);
}

/** Paid hourly: the team list is kept up to date and each day is linked to the person; nothing to do when paid by amount */
const teamIds = (mode: PayMode, projectId: string, contractorName: string, workers: PayWorker[]) =>
  mode === "hourly" ? syncTeam(prisma, projectId, contractorName, workers) : Promise.resolve(new Map<string, string>());

/** Which attendance records this person may see: access is company-wide, so it is one project or all of them */
async function visibleScope(userId: string, projectId: string | undefined): Promise<Prisma.AttendanceWhereInput> {
  if (projectId) {
    await requirePermission(userId, projectId, "attendance.view");
    return { projectId };
  }
  await requireCan(userId, "attendance.view");
  return {};
}

/**
 * Newest first, with search and server-side pagination. Without projectId it returns recent records across your projects.
 * With ?grouped=true (the saved-records list), days saved together come back as one item: the batch's first day,
 * with every day of the batch under `batch`. Without it every day is its own item, as before (dashboards, recent list).
 */
export async function list(req: Request, res: Response) {
  const { projectId, q, trade, page, pageSize, grouped } = listQuerySchema.parse(req.query);

  const search: Prisma.AttendanceWhereInput = q
    ? { OR: [{ contractorName: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } }] }
    : {};
  const byTrade: Prisma.AttendanceWhereInput = trade === undefined ? {} : { trade: trade === "-" ? "" : trade };
  const oneRowPerBatch: Prisma.AttendanceWhereInput = grouped ? { OR: [{ batchId: null }, { batchLead: true }] } : {};
  const where: Prisma.AttendanceWhereInput = { AND: [await visibleScope(uid(req), projectId), search, byTrade, oneRowPerBatch] };

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

  // Every day of the batches on this page, in one query
  const batchIds = grouped ? [...new Set(items.flatMap((i) => (i.batchId ? [i.batchId] : [])))] : [];
  const batchDays = batchIds.length
    ? await prisma.attendance.findMany({ where: { batchId: { in: batchIds } }, include, orderBy: [{ date: "asc" }, { id: "asc" }] })
    : [];

  res.json({
    items: items.map((i) => ({ ...attendanceDto(i), batch: grouped && i.batchId ? batchDto(i.batchId, batchDays.filter((d) => d.batchId === i.batchId)) : null })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

/** Several days saved together, as one item: every day, the first and last date, and the total of all of them */
function batchDto(id: string, days: Parameters<typeof attendanceDto>[0][]) {
  const list = days.map(attendanceDto);
  const total = days.reduce((sum, d) => sum.plus(d.totalAmount), new Prisma.Decimal(0));
  return { id, count: list.length, from: list[0]?.date ?? null, to: list[list.length - 1]?.date ?? null, totalAmount: total.toNumber(), days: list };
}

export async function create(req: Request<unknown, unknown, CreateBody>, res: Response) {
  const userId = uid(req);
  const { projectId, contractorName, date, workers, extras, notes, payMode } = req.body;
  await requirePermission(userId, projectId, "attendance.write");
  const trade = await tradeFor(projectId, req.body.trade);
  checkHourly(payMode, workers);
  const rows = rowsOn(payMode, workers, undefined, await teamIds(payMode, projectId, contractorName, workers));
  if (rows.length === 0) throw new HttpError(400, "Enter the hours for at least one labourer.");

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
        payMode,
        totalAmount: computeTotal(rows, extras),
        workers: { create: workerRows(rows) },
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

/** Each day's labourers and total, worked out once; the client's totals are never trusted */
function buildDays(mode: PayMode, workers: CreateManyBody["workers"], days: string[], extras: number, ids: Map<string, string>) {
  let total = new Prisma.Decimal(0);
  const entries = days.map((date) => {
    const onDay = rowsOn(mode, workers, date, ids);
    const dayTotal = computeTotal(onDay, extras);
    total = total.plus(dayTotal);
    return { id: randomUUID(), date, onDay, dayTotal };
  });
  return { entries, total };
}

/**
 * Writes the days with two bulk inserts. The number of queries stays the same whether it is 2 days or 62 (saving day by
 * day used to run so many queries in one transaction that a slow database couldn't finish in time).
 * Several days share a batchId; the first day is the batch's lead, the one the saved-records list shows.
 */
async function writeDays(
  tx: Prisma.TransactionClient,
  entries: ReturnType<typeof buildDays>["entries"],
  fields: { ownerId: string; projectId: string; contractorName: string; trade: string; extras: number; notes: string; payMode: PayMode; batchId: string | null; createdAt?: Date }
) {
  const { batchId, ...rest } = fields;
  await tx.attendance.createMany({
    data: entries.map((e, i) => ({ ...rest, id: e.id, date: toDate(e.date), totalAmount: e.dayTotal, batchId, batchLead: batchId !== null && i === 0 })),
  });
  await tx.attendanceWorker.createMany({
    data: entries.flatMap((e) => workerRows(e.onDay).map((w) => ({ ...w, attendanceId: e.id }))),
  });
}

const emptyDaysProblem = (empty: string[]) =>
  `Nothing is paid on ${empty.join(", ")}. Enter the amounts for ${empty.length === 1 ? "that day" : "those days"}, or remove ${empty.length === 1 ? "it" : "them"}.`;

/**
 * Several days at once: one entry per day, so each day is counted on its own date. Each labourer can have a different
 * amount on each day. All are saved together or none are, and they stay together: listed, edited and deleted as one.
 */
export async function createMany(req: Request<unknown, unknown, CreateManyBody>, res: Response) {
  const userId = uid(req);
  const { projectId, contractorName, dates, workers, extras, notes, payMode } = req.body;
  await requirePermission(userId, projectId, "attendance.write");
  const trade = await tradeFor(projectId, req.body.trade);

  const days = [...dates].sort();
  checkHourly(payMode, workers);
  const empty = emptyDaysFor(payMode, workers, days, extras);
  if (empty.length) throw new HttpError(400, emptyDaysProblem(empty));

  const { entries, total } = buildDays(payMode, workers, days, extras, await teamIds(payMode, projectId, contractorName, workers));
  const batchId = entries.length > 1 ? randomUUID() : null;

  await prisma.$transaction(
    async (tx) => {
      await writeDays(tx, entries, { ownerId: userId, projectId, contractorName, trade, extras, notes, payMode, batchId });
      await recordAudit(tx, {
        projectId,
        actorId: userId,
        action: "attendance.created",
        entityType: "attendance",
        entityId: batchId ?? entries[0]?.id ?? null,
        summary: `Added attendance for ${contractorName} on ${days.length} days (${days[0] ?? ""} to ${days[days.length - 1] ?? ""}): total ${total.toNumber()}`,
        changes: { totalAmount: { from: null, to: total.toNumber() }, days: { from: null, to: days.join(", ") } },
      });
    },
    { maxWait: 10_000, timeout: 30_000 }
  );

  const records = await prisma.attendance.findMany({ where: { id: { in: entries.map((e) => e.id) } }, include, orderBy: { date: "asc" } });
  res.status(201).json({ attendance: records.map(attendanceDto), count: records.length, batchId });
}

/**
 * PUT /attendance/bulk/:batchId: edit days saved together, in one go. The days can change too: a day taken out is
 * deleted, a day added is created. The batch keeps its place in the list (its first save time) and who entered it.
 */
export async function updateBatch(req: Request<{ batchId: string }, unknown, CreateManyBody>, res: Response) {
  const userId = uid(req);
  const { batchId } = req.params;
  const { contractorName, dates, workers, extras, notes, payMode } = req.body;

  const before = await prisma.attendance.findMany({ where: { batchId }, orderBy: [{ date: "asc" }, { id: "asc" }] });
  const lead = before.find((b) => b.batchLead) ?? before[0];
  if (!lead) throw new HttpError(404, "These entries were not found. They may have been deleted.");
  await requirePermission(userId, lead.projectId, "attendance.write");
  const trade = await tradeFor(lead.projectId, req.body.trade);

  const days = [...dates].sort();
  checkHourly(payMode, workers);
  const empty = emptyDaysFor(payMode, workers, days, extras);
  if (empty.length) throw new HttpError(400, emptyDaysProblem(empty));

  const { entries, total } = buildDays(payMode, workers, days, extras, await teamIds(payMode, lead.projectId, contractorName, workers));
  const was = before.reduce((sum, b) => sum.plus(b.totalAmount), new Prisma.Decimal(0));
  const beforeDays = before.map((b) => toDay(b.date)).join(", ");

  await prisma.$transaction(
    async (tx) => {
      await tx.attendance.deleteMany({ where: { batchId } }); // their labourers go with them (onDelete: Cascade)
      await writeDays(tx, entries, { ownerId: lead.ownerId, projectId: lead.projectId, contractorName, trade, extras, notes, payMode, batchId, createdAt: lead.createdAt });
      await recordAudit(tx, {
        projectId: lead.projectId,
        actorId: userId,
        action: "attendance.updated",
        entityType: "attendance",
        entityId: batchId,
        summary: `Edited attendance for ${contractorName}: ${days.length} days (${days[0] ?? ""} to ${days[days.length - 1] ?? ""})`,
        changes: {
          totalAmount: { from: was.toNumber(), to: total.toNumber() },
          ...(beforeDays !== days.join(", ") ? { days: { from: beforeDays, to: days.join(", ") } } : {}),
        },
      });
    },
    { maxWait: 10_000, timeout: 30_000 }
  );

  const records = await prisma.attendance.findMany({ where: { batchId }, include, orderBy: { date: "asc" } });
  res.json({ attendance: records.map(attendanceDto), count: records.length, batchId });
}

/** DELETE /attendance/bulk/:batchId: every day saved together. Like a single delete, it needs a manager. */
export async function removeBatch(req: Request<{ batchId: string }>, res: Response) {
  const userId = uid(req);
  const { batchId } = req.params;
  const before = await prisma.attendance.findMany({ where: { batchId }, orderBy: { date: "asc" } });
  const lead = before[0];
  if (!lead) throw new HttpError(404, "These entries were not found. They may have been deleted.");
  await requirePermission(userId, lead.projectId, "project.manage");
  const was = before.reduce((sum, b) => sum.plus(b.totalAmount), new Prisma.Decimal(0));

  await prisma.$transaction(async (tx) => {
    await tx.attendance.deleteMany({ where: { batchId } });
    await recordAudit(tx, {
      projectId: lead.projectId,
      actorId: userId,
      action: "attendance.deleted",
      entityType: "attendance",
      entityId: batchId,
      summary: `Deleted attendance for ${lead.contractorName} on ${before.length} days (${toDay(lead.date)} to ${toDay(before[before.length - 1]!.date)}): total ${was.toNumber()}`,
      changes: { totalAmount: { from: was.toNumber(), to: null } },
    });
  });
  res.status(204).end();
}

export async function update(req: Request<{ id: string }, unknown, UpdateBody>, res: Response) {
  const userId = uid(req);
  const { id } = req.params;
  const { contractorName, date, workers, extras, notes } = req.body;

  const before = await prisma.attendance.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Record not found");
  await requirePermission(userId, before.projectId, "attendance.write");
  const trade = req.body.trade === undefined ? before.trade : await tradeFor(before.projectId, req.body.trade);
  const payMode: PayMode = req.body.payMode ?? (before.payMode === "hourly" ? "hourly" : "amount");
  checkHourly(payMode, workers);
  const rows = rowsOn(payMode, workers, undefined, await teamIds(payMode, before.projectId, contractorName, workers));
  if (rows.length === 0) throw new HttpError(400, "Enter the hours for at least one labourer.");

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
        payMode,
        totalAmount: computeTotal(rows, extras),
        workers: { deleteMany: {}, create: workerRows(rows) },
      },
      include,
    });
    const facts = (r: { contractorName: string; trade: string; date: Date; extras: Prisma.Decimal; totalAmount: Prisma.Decimal }) => ({
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
export async function remove(req: Request<{ id: string }>, res: Response) {
  const userId = uid(req);
  const { id } = req.params;

  const before = await prisma.attendance.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Record not found");
  await requirePermission(userId, before.projectId, "project.manage");

  await prisma.$transaction(async (tx) => {
    await tx.attendance.delete({ where: { id } }); // workers are removed by the database (onDelete: Cascade)
    // The batch's listed day was deleted: list the next one instead, so the rest of the batch doesn't vanish
    if (before.batchId && before.batchLead) {
      const next = await tx.attendance.findFirst({ where: { batchId: before.batchId }, orderBy: [{ date: "asc" }, { id: "asc" }], select: { id: true } });
      if (next) await tx.attendance.update({ where: { id: next.id }, data: { batchLead: true } });
    }
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
export async function trades(req: Request, res: Response) {
  const { projectId } = tradesQuerySchema.parse(req.query);
  await requirePermission(uid(req), projectId, "attendance.view");

  const today = dayKeyIn(new Date());
  const weekFrom = toDate(new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10));
  const monthFrom = toDate(`${today.slice(0, 7)}-01`);
  const sumBy = (from?: Date) =>
    prisma.attendance.groupBy({ by: ["trade"], where: { projectId, ...(from ? { date: { gte: from } } : {}) }, _sum: { totalAmount: true }, _count: { _all: true }, _max: { date: true } });

  const [all, week, month, people, recent] = await Promise.all([
    sumBy(),
    sumBy(weekFrom),
    sumBy(monthFrom),
    prisma.attendance.findMany({ where: { projectId }, distinct: ["trade", "contractorName"], select: { trade: true, contractorName: true } }),
    prisma.attendance.findMany({ where: { projectId, trade: { not: "" } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500, select: { contractorName: true, trade: true } }),
  ]);
  const total = (g: (typeof all)[number]) => g._sum.totalAmount?.toNumber() ?? 0;
  const used = all.map((g) => g.trade).filter(Boolean);

  res.json({
    trades: tradeSummaries(
      all.map((g) => ({ trade: g.trade, entries: g._count._all, total: total(g), lastDate: g._max.date ? toDay(g._max.date) : null })),
      week.map((g) => ({ trade: g.trade, total: total(g) })),
      month.map((g) => ({ trade: g.trade, total: total(g) })),
      people
    ),
    choices: [...used, ...DEFAULT_TRADES.filter((d) => !used.some((u) => u.toLowerCase() === d.toLowerCase()))],
    usual: usualTrade(recent),
  });
}

/** PATCH /attendance/trade: give a contractor's entries a trade in one go (the one-time sort of old entries) */
export async function setTrade(req: Request<unknown, unknown, SetTradeBody>, res: Response) {
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