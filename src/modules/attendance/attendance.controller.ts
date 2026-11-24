import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { toDay } from "../../lib/dates.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { assertWeeksOpen } from "../labour-weeks/labour-weeks.service.js";
import { diffFields, hasChanges } from "../audit/audit.diff.js";
import { recordAudit } from "../audit/audit.service.js";
import { attendanceDto, toDate } from "./attendance.mapper.js";
import { emptyDaysFor, missingRates, repeatedNames, rowsOn, type DayRow, type PayMode, type PayWorker } from "./attendance.hourly.js";
import { syncTeam } from "./attendance.team.js";
import { createManyAttendanceSchema, listQuerySchema, tradesQuerySchema, type AddWorkItemBody, type CreateBody, type CreateManyBody, type SetTradeBody, type UpdateBody } from "./atttendance.schema.js";
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

/** The work item the days are for: one of this project's work items, or null for General */
async function taskFor(projectId: string, taskId: string | null | undefined) {
  if (!taskId) return null;
  const task = await prisma.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } });
  if (!task) throw new HttpError(400, "That work item isn't in this project any more. Pick the work item again.");
  return task.id;
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
  const taskId = await taskFor(projectId, req.body.taskId);
  checkHourly(payMode, workers);
  await assertWeeksOpen(projectId, trade, contractorName, [date]); // a settled (paid) week can't change
  const rows = rowsOn(payMode, workers, undefined, await teamIds(payMode, projectId, contractorName, workers));
  if (rows.length === 0) throw new HttpError(400, "Enter the hours for at least one labourer.");

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.attendance.create({
      data: {
        ownerId: userId, // who entered it
        projectId,
        contractorName,
        trade,
        taskId,
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
  fields: { ownerId: string; projectId: string; contractorName: string; trade: string; taskId: string | null; extras: number; notes: string; payMode: PayMode; batchId: string | null; createdAt?: Date }
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
  const taskId = await taskFor(projectId, req.body.taskId);

  const days = [...dates].sort();
  checkHourly(payMode, workers);
  const empty = emptyDaysFor(payMode, workers, days, extras);
  if (empty.length) throw new HttpError(400, emptyDaysProblem(empty));
  await assertWeeksOpen(projectId, trade, contractorName, days);

  const { entries, total } = buildDays(payMode, workers, days, extras, await teamIds(payMode, projectId, contractorName, workers));
  const batchId = entries.length > 1 ? randomUUID() : null;

  await prisma.$transaction(
    async (tx) => {
      await writeDays(tx, entries, { ownerId: userId, projectId, contractorName, trade, taskId, extras, notes, payMode, batchId });
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
  const taskId = req.body.taskId === undefined ? lead.taskId : await taskFor(lead.projectId, req.body.taskId);

  const days = [...dates].sort();
  checkHourly(payMode, workers);
  const empty = emptyDaysFor(payMode, workers, days, extras);
  if (empty.length) throw new HttpError(400, emptyDaysProblem(empty));
  await assertWeeksOpen(lead.projectId, lead.trade, lead.contractorName, before.map((b) => toDay(b.date)));
  await assertWeeksOpen(lead.projectId, trade, contractorName, days);

  const { entries, total } = buildDays(payMode, workers, days, extras, await teamIds(payMode, lead.projectId, contractorName, workers));
  const was = before.reduce((sum, b) => sum.plus(b.totalAmount), new Prisma.Decimal(0));
  const beforeDays = before.map((b) => toDay(b.date)).join(", ");

  await prisma.$transaction(
    async (tx) => {
      await tx.attendance.deleteMany({ where: { batchId } }); // their labourers go with them (onDelete: Cascade)
      await writeDays(tx, entries, { ownerId: lead.ownerId, projectId: lead.projectId, contractorName, trade, taskId, extras, notes, payMode, batchId, createdAt: lead.createdAt });
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
  await assertWeeksOpen(lead.projectId, lead.trade, lead.contractorName, before.map((b) => toDay(b.date)));
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
  const taskId = req.body.taskId === undefined ? before.taskId : await taskFor(before.projectId, req.body.taskId);
  const payMode: PayMode = req.body.payMode ?? (before.payMode === "hourly" ? "hourly" : "amount");
  checkHourly(payMode, workers);
  await assertWeeksOpen(before.projectId, before.trade, before.contractorName, [toDay(before.date)]);
  await assertWeeksOpen(before.projectId, trade, contractorName, [date]);
  const rows = rowsOn(payMode, workers, undefined, await teamIds(payMode, before.projectId, contractorName, workers));
  if (rows.length === 0) throw new HttpError(400, "Enter the hours for at least one labourer.");

  // One statement: replace the workers and update the record together (atomic)
  const record = await prisma.$transaction(async (tx) => {
    const updated = await tx.attendance.update({
      where: { id },
      data: {
        contractorName,
        trade,
        taskId,
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
  await assertWeeksOpen(before.projectId, before.trade, before.contractorName, [toDay(before.date)]);

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

/* ---------------------------------------------------------------------------------------------------------------
 * Registers: one per contractor (team head). Every day of their attendance lives in one place; days in a week that
 * was settled (paid) are kept but locked and left out of the sheet, so the sheet only ever shows what is still open.
 * ------------------------------------------------------------------------------------------------------------- */

const nameKeyOf = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const num = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The Monday of a "YYYY-MM-DD" day's pay week */
function mondayOf(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const sundayOf = (monday: string) => {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
};

/** Settled pay weeks of a project, as "trade|name@monday" keys (matching labour-weeks' contractorKey) */
async function settledKeys(projectId: string) {
  const rows = await prisma.labourWeek.findMany({ where: { projectId }, select: { contractorKey: true, weekStart: true } });
  return new Set(rows.map((r) => `${r.contractorKey}@${r.weekStart.toISOString().slice(0, 10)}`));
}
const isSettled = (closed: Set<string>, trade: string, contractorName: string, date: string) =>
  closed.has(`${nameKeyOf(trade)}|${nameKeyOf(contractorName)}@${mondayOf(date)}`);

/**
 * GET /attendance/registers?projectId=&q= : one row per contractor and work item (taskId null = General). Open days
 * (not in a settled week) one by one; settled weeks as one line each; `workTotal` = this work item's attendance.
 * Earned (attendance + contract work), paid and still to pay stay the contractor's as a whole, as in the ledger:
 * payments are made to the contractor, not per work item.
 */
export async function registers(req: Request, res: Response) {
  const userId = uid(req);
  const projectId = String(req.query.projectId ?? "");
  const q = nameKeyOf(String(req.query.q ?? "")).slice(0, 80);
  if (!projectId) throw new HttpError(400, "projectId is required");
  await requirePermission(userId, projectId, "attendance.view");

  const [rows, measures, payments, closed] = await Promise.all([
    prisma.attendance.findMany({
      where: { projectId },
      select: { date: true, trade: true, contractorName: true, totalAmount: true, createdAt: true, taskId: true, task: { select: { work: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.labourMeasure.groupBy({ by: ["contractorName"], where: { projectId }, _sum: { amount: true } }),
    prisma.contractorPayment.groupBy({ by: ["contractorName"], where: { projectId }, _sum: { amount: true } }),
    settledKeys(projectId),
  ]);

  type Reg = {
    key: string;
    person: string; // the contractor's key, for their earned / paid / to pay
    contractorName: string;
    taskId: string | null;
    work: string; // the work item's name; "" = General
    open: Map<string, number>;
    settled: Map<string, number>;
    attendance: number; // this contractor, this work item
    lastDate: string;
    lastSaved: number;
  };
  const regs = new Map<string, Reg>();
  const allAttendance = new Map<string, number>(); // each contractor's attendance over every work item
  for (const r of rows) {
    const person = nameKeyOf(r.contractorName);
    const key = `${person}|${r.taskId ?? ""}`;
    let g = regs.get(key);
    if (!g)
      regs.set(key, (g = { key, person, contractorName: r.contractorName.trim(), taskId: r.taskId, work: r.task?.work ?? "", open: new Map(), settled: new Map(), attendance: 0, lastDate: "", lastSaved: 0 }));
    const day = toDay(r.date);
    const amount = num(r.totalAmount);
    g.attendance += amount;
    allAttendance.set(person, (allAttendance.get(person) ?? 0) + amount);
    if (day >= g.lastDate) {
      g.lastDate = day;
      g.contractorName = r.contractorName.trim(); // the newest spelling
    }
    g.lastSaved = Math.max(g.lastSaved, r.createdAt.getTime());
    if (isSettled(closed, r.trade, r.contractorName, day)) {
      const w = mondayOf(day);
      g.settled.set(w, (g.settled.get(w) ?? 0) + amount);
    } else g.open.set(day, (g.open.get(day) ?? 0) + amount);
  }
  const sumBy = (list: { contractorName: string; _sum: { amount: { toNumber(): number } | null } }[]) => {
    const m = new Map<string, number>();
    for (const x of list) m.set(nameKeyOf(x.contractorName), (m.get(nameKeyOf(x.contractorName)) ?? 0) + num(x._sum.amount));
    return m;
  };
  const contract = sumBy(measures);
  const paid = sumBy(payments);

  const items = [...regs.values()]
    .filter((g) => !q || g.person.includes(q) || nameKeyOf(g.work || "general").includes(q))
    .map((g) => {
      const earned = round2((allAttendance.get(g.person) ?? 0) + (contract.get(g.person) ?? 0));
      const p = round2(paid.get(g.person) ?? 0);
      const openDays = [...g.open].map(([date, total]) => ({ date, total: round2(total) }));
      return {
        key: g.key,
        contractorName: g.contractorName,
        taskId: g.taskId,
        work: g.work,
        workTotal: round2(g.attendance),
        openDays,
        openTotal: round2(openDays.reduce((s, d) => s + d.total, 0)),
        settledWeeks: [...g.settled].map(([start, total]) => ({ start, end: sundayOf(start), total: round2(total) })),
        earned,
        paid: p,
        toPay: round2(earned - p),
        lastDate: g.lastDate,
        lastSaved: g.lastSaved,
      };
    })
    .sort((a, b) => b.lastSaved - a.lastSaved) // the one worked on last first
    .map(({ lastSaved: _drop, ...rest }) => rest);
  res.json({ items });
}

/**
 * GET /attendance/sheet?projectId=&contractor= : the contractor's open days in full (labourers, hours, rates), to open
 * as one sheet. Settled days are not included; their weeks come back as a short summary.
 */
export async function getSheet(req: Request, res: Response) {
  const userId = uid(req);
  const projectId = String(req.query.projectId ?? "");
  const contractor = String(req.query.contractor ?? "").trim();
  if (!projectId || !contractor || contractor.length > 120) throw new HttpError(400, "projectId and contractor are required");
  await requirePermission(userId, projectId, "attendance.view");
  // ?task=<id>: only that work item's days; ?task=general: days with no work item; left out: every day (older screens)
  const rawTask = req.query.task === undefined ? undefined : String(req.query.task).slice(0, 64);
  const byTask: Prisma.AttendanceWhereInput = rawTask === undefined ? {} : { taskId: rawTask === "general" || rawTask === "" ? null : rawTask };

  const [rows, closed] = await Promise.all([
    prisma.attendance.findMany({ where: { projectId, contractorName: { equals: contractor, mode: "insensitive" }, ...byTask }, include, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    settledKeys(projectId),
  ]);
  const open = rows.filter((r) => !isSettled(closed, r.trade, r.contractorName, toDay(r.date)));
  const settled = rows.filter((r) => isSettled(closed, r.trade, r.contractorName, toDay(r.date)));
  const weeks = new Map<string, number>();
  for (const r of settled) weeks.set(mondayOf(toDay(r.date)), (weeks.get(mondayOf(toDay(r.date))) ?? 0) + num(r.totalAmount));

  // The work item the sheet is for, so the form shows it on top (null = General; left out when ?task wasn't asked)
  const taskId = rawTask === undefined ? undefined : (byTask.taskId as string | null);
  const work = taskId ? ((await prisma.task.findFirst({ where: { id: taskId, projectId }, select: { work: true } }))?.work ?? "") : "";

  res.json({
    contractorName: open.at(-1)?.contractorName ?? rows.at(-1)?.contractorName ?? contractor,
    ...(taskId === undefined ? {} : { taskId, work }),
    ids: open.map((r) => r.id),
    // Shaped like days saved together, so the form opens it the same way
    sheet: open.length ? batchDto("sheet", open) : null,
    settledWeeks: [...weeks].map(([start, total]) => ({ start, end: sundayOf(start), total: round2(total) })),
  });
}

/**
 * PUT /attendance/sheet : save a contractor's sheet. The open days it was opened with (`replaceIds`) are replaced by
 * the days as edited (a day added is created, a day taken out is deleted), all as one set of days saved together.
 * Every replaced entry must be this project's and this contractor's, and no day may be in a settled week.
 */
export async function saveSheet(req: Request, res: Response) {
  const userId = uid(req);
  // Checked here rather than by the route: the same rules as "several days", plus the ids of the days being replaced
  const parsed = createManyAttendanceSchema.safeParse({ body: req.body });
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the sheet and try again.");
  const { projectId, contractorName, dates, workers, extras, notes, payMode } = parsed.data.body;
  const raw = (req.body as { replaceIds?: unknown }).replaceIds;
  const replaceIds = Array.isArray(raw) ? raw : [];
  if (replaceIds.length > 500 || !replaceIds.every((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id)))
    throw new HttpError(400, "The sheet could not be read. Open it again.");
  await requirePermission(userId, projectId, "attendance.write");

  const before = await prisma.attendance.findMany({ where: { id: { in: replaceIds } } });
  if (before.length !== replaceIds.length) throw new HttpError(409, "Some of these days were changed or deleted by someone else. Open the sheet again.");
  const owner = nameKeyOf(contractorName);
  if (before.some((b) => b.projectId !== projectId || nameKeyOf(b.contractorName) !== owner))
    throw new HttpError(400, "These days belong to another contractor or project.");

  const trade = before[0]?.trade ?? (await tradeFor(projectId, parsed.data.body.trade ?? ""));
  // The sheet stays on its work item unless the form sends another one
  const taskId = parsed.data.body.taskId === undefined ? (before[0]?.taskId ?? null) : await taskFor(projectId, parsed.data.body.taskId);
  const days = [...dates].sort();
  checkHourly(payMode, workers);
  const empty = emptyDaysFor(payMode, workers, days, extras);
  if (empty.length) throw new HttpError(400, emptyDaysProblem(empty));
  for (const b of before) await assertWeeksOpen(projectId, b.trade, b.contractorName, [toDay(b.date)]);
  await assertWeeksOpen(projectId, trade, contractorName, days);

  const { entries, total } = buildDays(payMode, workers, days, extras, await teamIds(payMode, projectId, contractorName, workers));
  const batchId = entries.length > 1 ? randomUUID() : null;
  const was = before.reduce((s, b) => s.plus(b.totalAmount), new Prisma.Decimal(0));

  await prisma.$transaction(
    async (tx) => {
      if (before.length) await tx.attendance.deleteMany({ where: { id: { in: before.map((b) => b.id) } } });
      await writeDays(tx, entries, { ownerId: before[0]?.ownerId ?? userId, projectId, contractorName, trade, taskId, extras, notes, payMode, batchId, createdAt: before[0]?.createdAt });
      await recordAudit(tx, {
        projectId,
        actorId: userId,
        action: before.length ? "attendance.updated" : "attendance.created",
        entityType: "attendance",
        entityId: batchId ?? entries[0]?.id ?? null,
        summary: `Saved ${contractorName}'s sheet: ${days.length} open days (${days[0] ?? ""} to ${days.at(-1) ?? ""})`,
        changes: { totalAmount: { from: was.toNumber(), to: total.toNumber() } },
      });
    },
    { maxWait: 10_000, timeout: 30_000 }
  );

  const records = await prisma.attendance.findMany({ where: { id: { in: entries.map((e) => e.id) } }, include, orderBy: { date: "asc" } });
  res.json({ attendance: records.map(attendanceDto), count: records.length, batchId });
}

/* ------------------------------------------- work items ------------------------------------------- */

/**
 * GET /attendance/work-items?projectId= : the project's work items (the same list as the Overview), each with the
 * attendance marked under it so far, plus General (days with no work item). The Mark attendance tab picks from these;
 * Rate comparison shows each one's actual labour against its rates.
 */
export async function workItems(req: Request, res: Response) {
  const userId = uid(req);
  const projectId = String(req.query.projectId ?? "");
  if (!projectId || projectId.length > 64) throw new HttpError(400, "projectId is required");
  await requirePermission(userId, projectId, "attendance.view");

  const [tasks, sums] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, work: true } }),
    prisma.attendance.groupBy({ by: ["taskId"], where: { projectId, archivedAt: null }, _sum: { totalAmount: true }, _count: { _all: true } }), // archived days count nowhere
  ]);
  const total = (taskId: string | null) => round2(num(sums.find((x) => x.taskId === taskId)?._sum.totalAmount));
  const days = (taskId: string | null) => sums.find((x) => x.taskId === taskId)?._count._all ?? 0;
  res.json({
    items: tasks.map((t) => ({ id: t.id, work: t.work, total: total(t.id), days: days(t.id) })),
    general: { total: total(null), days: days(null) },
  });
}

/**
 * POST /attendance/work-items : add a work item by name only, from the Mark attendance tab. It is a normal work item of
 * the project (area and rates 0, today to 30 days on), so it shows on the Overview and in Rate comparison too, where the
 * rest can be filled in. The same name again (any capitals) gives back the one already there.
 */
export async function addWorkItem(req: Request<unknown, unknown, AddWorkItemBody>, res: Response) {
  const userId = uid(req);
  const { projectId } = req.body;
  const work = req.body.work.replace(/\s+/g, " ").trim();
  await requirePermission(userId, projectId, "attendance.write");

  const same = await prisma.task.findFirst({ where: { projectId, work: { equals: work, mode: "insensitive" } }, select: { id: true, work: true } });
  if (same) {
    res.json({ item: same, created: false });
    return;
  }
  const last = await prisma.task.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
  const start = new Date(`${toDay(new Date())}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 30 * 864e5);
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: { projectId, work, area: 0, contractorRate: 0, inHouseRate: 0, stipulated: 0, startDate: start, endDate: end, position: (last?.position ?? -1) + 1 },
      select: { id: true, work: true },
    });
    await recordAudit(tx, {
      projectId,
      actorId: userId,
      action: "task.created",
      entityType: "task",
      entityId: created.id,
      summary: `Added work item "${work}" from attendance`,
    });
    return created;
  });
  res.status(201).json({ item, created: true });
}