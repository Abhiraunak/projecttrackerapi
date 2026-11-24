import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { drawingUrls } from "../../lib/cloudinary.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import type { ArchivedDelete, BillInput, BillPaymentInput, CopyDay, MeasureInput, PeriodPaymentInput, SaveDay, SubPaymentInput } from "./labourSimple.schema.js";

/*
 * The simple Labour section, on the tables already there (attendance with hours and OT, contractor payments, contract
 * work, work items) plus subcontractor quotes. Everything can be changed at any time: these routes don't use the old
 * "settled week" lock. Seeing needs "View attendance"; changing needs "Mark attendance".
 */

const VIEW = "attendance.view";
const WRITE = "attendance.write";
type Num = { toNumber(): number };
const num = (v: Num | null | undefined) => (v ? v.toNumber() : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const today = () => dayKeyIn(new Date());
const same = (name: string) => ({ equals: name.trim(), mode: "insensitive" as const });
const live = { archivedAt: null }; // archived rows are hidden and counted nowhere
const gone = { archivedAt: { not: null } };
const keyOf = (n: string) => n.trim().toLowerCase();
const taskOf = (taskId: string | undefined | null) => (taskId ? taskId : null);
const notFuture = (date: string) => {
  if (date > today()) throw new HttpError(400, "The date can't be in the future.");
};
const checkRange = (from: string, to: string) => {
  if (from > to) throw new HttpError(400, "The From date is after the To date.");
};
const whoIs = async (userId: string) => {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return u?.name || u?.email || "Someone";
};
async function assertTask(projectId: string, taskId: string | null) {
  if (!taskId) return;
  const t = await prisma.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } });
  if (!t) throw new HttpError(400, "That work is no longer there.");
}

/** A worker's pay for the day: hours × rate + OT hours × OT rate; an old day kept only as an amount keeps it */
function payOf(w: { hours: number; otHours: number; rate: number; otRate: number; fixed: number | null }) {
  if (w.fixed !== null && w.hours === 0 && w.otHours === 0 && w.rate === 0) return r2(w.fixed);
  return r2(w.hours * w.rate + w.otHours * w.otRate);
}

type WorkerRow = { label: string; amount: Num; position: number; hours: Num | null; otHours: Num | null; hourlyRate: Num | null; otRate: Num | null };
const workerDto = (w: WorkerRow) => {
  const hourly = w.hours !== null || w.hourlyRate !== null;
  const rate = num(w.hourlyRate);
  return {
    name: w.label,
    hours: num(w.hours),
    otHours: num(w.otHours),
    rate,
    otRate: w.otRate ? w.otRate.toNumber() : rate, // overtime at the same rate unless set
    fixed: hourly ? null : num(w.amount), // an older day saved as amounts only
    amount: num(w.amount),
  };
};
const workerSelect = { label: true, amount: true, position: true, hours: true, otHours: true, hourlyRate: true, otRate: true } as const;

/* ------------------------------------------------ attendance ------------------------------------------------ */

/** GET …/labour-simple/day: one contractor's crew on one work on one day, and the last crew before it ("Same as yesterday") */
export async function getDay(userId: string, projectId: string, q: { date: string; contractor: string; taskId?: string }) {
  await requirePermission(userId, projectId, VIEW);
  const taskId = taskOf(q.taskId);
  const where = { projectId, contractorName: same(q.contractor), taskId };
  const [rows, before] = await Promise.all([
    prisma.attendance.findMany({ where: { ...where, ...live, date: day(q.date) }, orderBy: { createdAt: "asc" }, select: { extras: true, workers: { select: workerSelect, orderBy: { position: "asc" } } } }),
    prisma.attendance.findFirst({ where: { ...where, ...live, date: { lt: day(q.date) } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: { date: true, workers: { select: workerSelect, orderBy: { position: "asc" } } } }),
  ]);
  const workers = rows.flatMap((r) => r.workers.map(workerDto));
  const extras = r2(rows.reduce((s, r) => s + num(r.extras), 0)); // extra amounts on older days, kept as they are
  return {
    workers,
    extras,
    total: r2(workers.reduce((s, w) => s + w.amount, 0) + extras),
    last: before ? { date: ymdOf(before.date), workers: before.workers.map(workerDto) } : null,
  };
}

/**
 * PUT …/labour-simple/day: save one contractor's crew on one work on one day, replacing what was there (one
 * transaction). With `forward`, the rates typed here also apply to the same workers' later days with this contractor
 * and work, and those days' amounts follow.
 */
export async function saveDay(userId: string, projectId: string, input: SaveDay) {
  await requirePermission(userId, projectId, WRITE);
  // future dates are allowed: attendance can be planned ahead and changed later
  await assertTask(projectId, input.taskId);
  const where = { projectId, contractorName: same(input.contractorName), taskId: input.taskId };
  const existing = await prisma.attendance.findMany({
    where: { ...where, date: day(input.date) },
    orderBy: { createdAt: "asc" },
    select: { id: true, trade: true, contractorName: true, extras: true, notes: true },
  });
  const trade = existing[0]?.trade ?? "";
  const contractorName = existing[0]?.contractorName ?? input.contractorName.trim();
  // An older day's extra amounts and notes are carried over, so changing it here never loses them
  const extras = r2(existing.reduce((s, e) => s + num(e.extras), 0));
  const notes = existing.map((e) => e.notes.trim()).filter(Boolean).join(" · ");
  const workers = input.workers.map((w, position) => ({ ...w, position, amount: payOf(w) }));
  const total = r2(workers.reduce((s, w) => s + w.amount, 0) + extras);

  await prisma.$transaction(async (tx) => {
    if (existing.length) await tx.attendance.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } }); // workers cascade
    if (workers.length || extras)
      await tx.attendance.create({
        data: {
          projectId,
          ownerId: userId,
          contractorName,
          trade,
          date: day(input.date),
          taskId: input.taskId,
          payMode: "hourly",
          extras,
          notes,
          totalAmount: total,
          workers: {
            create: workers.map((w) => {
              const kept = w.fixed !== null && w.hours === 0 && w.otHours === 0 && w.rate === 0;
              return {
                label: w.name,
                amount: w.amount,
                position: w.position,
                hours: kept ? null : w.hours,
                otHours: kept ? null : w.otHours,
                hourlyRate: kept ? null : w.rate,
                otRate: kept ? null : w.otRate,
              };
            }),
          },
        },
      });

    if (input.forward) {
      const later = await tx.attendance.findMany({
        where: { ...where, date: { gt: day(input.date) } },
        select: { id: true, extras: true, workers: { select: { id: true, label: true, amount: true, hours: true, otHours: true } } },
      });
      const rates = new Map(workers.filter((w) => w.rate > 0 || w.otRate > 0).map((w) => [w.name.trim().toLowerCase(), w]));
      for (const a of later) {
        let changed = false;
        let sum = 0;
        for (const lw of a.workers) {
          const r = rates.get(lw.label.trim().toLowerCase());
          if (r && lw.hours !== null) {
            const amount = r2(num(lw.hours) * r.rate + num(lw.otHours) * r.otRate);
            await tx.attendanceWorker.update({ where: { id: lw.id }, data: { hourlyRate: r.rate, otRate: r.otRate, amount } });
            sum += amount;
            changed = true;
          } else sum += num(lw.amount);
        }
        if (changed) await tx.attendance.update({ where: { id: a.id }, data: { totalAmount: r2(sum + num(a.extras)) } });
      }
    }
  });
  return getDay(userId, projectId, { date: input.date, contractor: contractorName, taskId: input.taskId ?? undefined });
}

/**
 * POST …/labour-simple/copy: the crew saved on one day (workers, hours, OT, rates) copied to other days for the same
 * contractor and work, in one transaction. A day that already has an entry is skipped and never changed; the day itself
 * is left out. Future days are allowed. Each copied day is its own day afterwards, to change as usual.
 */
export async function copyDay(userId: string, projectId: string, input: CopyDay) {
  await requirePermission(userId, projectId, WRITE);
  await assertTask(projectId, input.taskId);
  const where = { projectId, contractorName: same(input.contractorName), taskId: input.taskId };
  const source = await prisma.attendance.findMany({
    where: { ...where, date: day(input.date) },
    orderBy: { createdAt: "asc" },
    select: { trade: true, contractorName: true, workers: { select: workerSelect, orderBy: { position: "asc" } } },
  });
  const workers = source.flatMap((r) => r.workers);
  if (workers.length === 0) throw new HttpError(400, "This day has nobody marked yet. Fill it first, then copy it.");

  const wanted = [...new Set(input.dates)].filter((d) => d !== input.date).sort(); // future days allowed
  const taken = await prisma.attendance.findMany({
    where: { ...where, date: { in: wanted.map(day) } },
    select: { date: true },
    distinct: ["date"],
  });
  const busy = new Set(taken.map((x) => ymdOf(x.date)));
  const added = wanted.filter((d) => !busy.has(d));
  const skipped = wanted.filter((d) => busy.has(d));
  const total = r2(workers.reduce((s, w) => s + num(w.amount), 0));

  await prisma.$transaction(async (tx) => {
    for (const d of added)
      await tx.attendance.create({
        data: {
          projectId,
          ownerId: userId,
          contractorName: source[0]!.contractorName,
          trade: source[0]!.trade,
          date: day(d),
          taskId: input.taskId,
          payMode: "hourly",
          totalAmount: total,
          workers: {
            create: workers.map((w, position) => ({
              label: w.label,
              amount: w.amount,
              position,
              hours: w.hours,
              otHours: w.otHours,
              hourlyRate: w.hourlyRate,
              otRate: w.otRate,
            })),
          },
        },
      });
  });
  return { added, skipped, perDay: total };
}

/** GET …/labour-simple/days: each day's total in a range (the week strip), for one contractor and work, or all */
export async function dayTotals(userId: string, projectId: string, q: { from: string; to: string; taskId?: string; contractor?: string }) {
  await requirePermission(userId, projectId, VIEW);
  checkRange(q.from, q.to);
  const rows = await prisma.attendance.groupBy({
    by: ["date"],
    where: {
      projectId,
      ...live,
      date: { gte: day(q.from), lte: day(q.to) },
      ...(q.taskId !== undefined ? { taskId: taskOf(q.taskId) } : {}),
      ...(q.contractor ? { contractorName: same(q.contractor) } : {}),
    },
    _sum: { totalAmount: true },
  });
  return { days: rows.map((r) => ({ date: ymdOf(r.date), total: r2(num(r._sum.totalAmount)) })) };
}

/** GET …/labour-simple/records: every saved day in a range (one work, one contractor, or all), newest first */
export async function records(userId: string, projectId: string, q: { from: string; to: string; taskId?: string; contractor?: string }) {
  await requirePermission(userId, projectId, VIEW);
  checkRange(q.from, q.to);
  const rows = await prisma.attendance.findMany({
    where: {
      projectId,
      ...live,
      date: { gte: day(q.from), lte: day(q.to) },
      ...(q.taskId !== undefined ? { taskId: taskOf(q.taskId) } : {}),
      ...(q.contractor ? { contractorName: same(q.contractor) } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 1000,
    select: { date: true, contractorName: true, taskId: true, totalAmount: true, task: { select: { work: true } }, workers: { select: { hours: true, otHours: true } } },
  });
  const items = rows.map((r) => ({
    date: ymdOf(r.date),
    contractorName: r.contractorName,
    taskId: r.taskId,
    work: r.task?.work ?? "General",
    workers: r.workers.length,
    hours: r2(r.workers.reduce((s, w) => s + num(w.hours), 0)),
    otHours: r2(r.workers.reduce((s, w) => s + num(w.otHours), 0)),
    amount: r2(num(r.totalAmount)),
  }));
  return { items, total: r2(items.reduce((s, i) => s + i.amount, 0)) };
}

/** GET …/labour-simple/works: the project's work items with their attendance cost so far */
export async function works(userId: string, projectId: string) {
  await requirePermission(userId, projectId, VIEW);
  const [tasks, sums] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, work: true, area: true } }),
    prisma.attendance.groupBy({ by: ["taskId"], where: { projectId, ...live }, _sum: { totalAmount: true } }),
  ]);
  const cost = (taskId: string | null) => r2(num(sums.find((s) => s.taskId === taskId)?._sum.totalAmount));
  return { items: tasks.map((t) => ({ id: t.id, title: t.work, quantity: t.area, cost: cost(t.id) })), general: cost(null) };
}

/** POST …/labour-simple/works: add a work by name (the same name again gives the one already there) */
export async function addWork(userId: string, projectId: string, title: string) {
  await requirePermission(userId, projectId, WRITE);
  const work = title.replace(/\s+/g, " ").trim();
  const found = await prisma.task.findFirst({ where: { projectId, work: same(work) }, select: { id: true, work: true } });
  if (found) return { item: { id: found.id, title: found.work } };
  const last = await prisma.task.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
  const start = day(today());
  const created = await prisma.task.create({
    data: { projectId, work, area: 0, contractorRate: 0, inHouseRate: 0, stipulated: 0, startDate: start, endDate: new Date(start.getTime() + 30 * 864e5), position: (last?.position ?? -1) + 1 },
    select: { id: true, work: true },
  });
  return { item: { id: created.id, title: created.work } };
}

/** PATCH …/labour-simple/works/:taskId: rename; every day marked under it stays with it */
export async function renameWork(userId: string, projectId: string, taskId: string, title: string) {
  await requirePermission(userId, projectId, WRITE);
  await assertTask(projectId, taskId);
  await prisma.task.update({ where: { id: taskId }, data: { work: title.replace(/\s+/g, " ").trim() } });
  return { ok: true };
}

/** GET …/labour-simple/people: everyone named in attendance, payments, contract work and quotes */
export async function people(userId: string, projectId: string) {
  await requirePermission(userId, projectId, VIEW);
  const [a, p, m, q] = await Promise.all([
    prisma.attendance.findMany({ where: { projectId, ...live }, distinct: ["contractorName"], select: { contractorName: true }, orderBy: { date: "desc" } }),
    prisma.contractorPayment.findMany({ where: { projectId, ...live }, distinct: ["contractorName"], select: { contractorName: true } }),
    prisma.labourMeasure.findMany({ where: { projectId, ...live }, distinct: ["contractorName"], select: { contractorName: true } }),
    prisma.labourQuote.findMany({ where: { projectId }, distinct: ["name"], select: { name: true } }),
  ]);
  const seen = new Map<string, string>();
  for (const n of [...a.map((x) => x.contractorName), ...m.map((x) => x.contractorName), ...p.map((x) => x.contractorName), ...q.map((x) => x.name)]) {
    const k = n.trim().toLowerCase();
    if (k && !seen.has(k)) seen.set(k, n.trim());
  }
  return { contractors: [...new Set(a.map((x) => x.contractorName.trim()))], everyone: [...seen.values()] };
}

/* ------------------------------------------------ payments ------------------------------------------------ */

const kindOf = (format: string) => (format === "pdf" ? "pdf" : "image") as "pdf" | "image";
type PayRow = { id: string; date: Date; amount: Num; remark: string; contractorName: string; proofId: string | null; proofVersion: number | null; proofFormat: string | null };
const paymentDto = (p: PayRow) => ({
  id: p.id,
  date: ymdOf(p.date),
  amount: r2(num(p.amount)),
  remark: p.remark,
  contractorName: p.contractorName,
  receiptUrl:
    p.proofId && p.proofVersion !== null && p.proofFormat
      ? drawingUrls({ publicId: p.proofId, version: p.proofVersion, format: p.proofFormat, kind: kindOf(p.proofFormat) }).openUrl
      : null,
});

/**
 * GET …/labour-simple/statement: one person between two dates: what they earned (attendance + contract work), every
 * payment made to them, and what is left; plus the same for all time, so nothing older is forgotten.
 */
export async function statement(userId: string, projectId: string, q: { person: string; from: string; to: string }) {
  await requirePermission(userId, projectId, VIEW);
  checkRange(q.from, q.to);
  const who = { projectId, contractorName: same(q.person), ...live };
  const range = { gte: day(q.from), lte: day(q.to) };
  const [att, meas, pays, attAll, measAll, paidAll] = await Promise.all([
    prisma.attendance.findMany({
      where: { ...who, date: range },
      orderBy: { date: "asc" },
      select: { date: true, totalAmount: true, task: { select: { work: true } }, workers: { select: { hours: true, otHours: true } } },
    }),
    prisma.labourMeasure.findMany({ where: { ...who, date: range }, orderBy: { date: "asc" }, select: { date: true, work: true, quantity: true, unit: true, rate: true, amount: true } }),
    prisma.contractorPayment.findMany({
      where: { ...who, date: range },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { id: true, date: true, amount: true, remark: true, contractorName: true, proofId: true, proofVersion: true, proofFormat: true },
    }),
    prisma.attendance.aggregate({ where: who, _sum: { totalAmount: true } }),
    prisma.labourMeasure.aggregate({ where: who, _sum: { amount: true } }),
    prisma.contractorPayment.aggregate({ where: who, _sum: { amount: true } }),
  ]);
  const days = att.map((a) => ({
    date: ymdOf(a.date),
    work: a.task?.work ?? "General",
    hours: r2(a.workers.reduce((s, w) => s + num(w.hours), 0)),
    otHours: r2(a.workers.reduce((s, w) => s + num(w.otHours), 0)),
    amount: r2(num(a.totalAmount)),
  }));
  const contract = meas.map((m) => ({ date: ymdOf(m.date), work: m.work, quantity: num(m.quantity), unit: m.unit, rate: num(m.rate), amount: r2(num(m.amount)) }));
  const earned = r2(days.reduce((s, d) => s + d.amount, 0) + contract.reduce((s, c) => s + c.amount, 0));
  const payments = pays.map(paymentDto);
  const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
  const earnedAll = r2(num(attAll._sum.totalAmount) + num(measAll._sum.amount));
  const paidAllN = r2(num(paidAll._sum.amount));
  return {
    person: q.person.trim(),
    from: q.from,
    to: q.to,
    earned,
    paid,
    balance: r2(earned - paid),
    days,
    contract,
    payments,
    allTime: { earned: earnedAll, paid: paidAllN, balance: r2(earnedAll - paidAllN) },
  };
}

/** PUT …/labour-simple/payments/:id: change a payment's person, date, amount or note (its receipt stays) */
export async function updatePayment(userId: string, projectId: string, id: string, input: { contractorName: string; date: string; amount: number; remark: string }) {
  await requirePermission(userId, projectId, WRITE);
  notFuture(input.date);
  const p = await prisma.contractorPayment.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!p) throw new HttpError(404, "That payment is no longer there.");
  await prisma.contractorPayment.update({ where: { id }, data: { contractorName: input.contractorName.trim(), date: day(input.date), amount: input.amount, remark: input.remark } });
  return { ok: true };
}

/* ------------------------------------------------ paid for a period ------------------------------------------------ */
/*
 * A payment with the days it covers (Attendance tab). Kept as an ordinary contractor payment, so it also counts in the
 * Payments tab: dated on the To day, or today when the period runs into the future.
 */

const periodSelect = { id: true, contractorName: true, amount: true, periodFrom: true, periodTo: true } as const;
type PeriodRow = { id: string; contractorName: string; amount: Num; periodFrom: Date | null; periodTo: Date | null };
const periodDto = (p: PeriodRow) => ({ id: p.id, name: p.contractorName, from: p.periodFrom ? ymdOf(p.periodFrom) : "", to: p.periodTo ? ymdOf(p.periodTo) : "", amount: r2(num(p.amount)) });
const paidOn = (to: string) => (to > today() ? today() : to);

/** GET …/labour-simple/period-payments: every "paid for a period" entry, latest period first */
export async function periodPayments(userId: string, projectId: string) {
  await requirePermission(userId, projectId, VIEW);
  const rows = await prisma.contractorPayment.findMany({
    where: { projectId, ...live, periodFrom: { not: null } },
    orderBy: [{ periodTo: "desc" }, { createdAt: "desc" }],
    take: 1000,
    select: periodSelect,
  });
  const items = rows.map(periodDto);
  return { items, total: r2(items.reduce((s, i) => s + i.amount, 0)) };
}

/** POST …/labour-simple/period-payments */
export async function addPeriodPayment(userId: string, projectId: string, input: PeriodPaymentInput) {
  await requirePermission(userId, projectId, WRITE);
  const row = await prisma.contractorPayment.create({
    data: {
      projectId,
      contractorName: input.name.trim(),
      date: day(paidOn(input.to)),
      amount: input.amount,
      periodFrom: day(input.from),
      periodTo: day(input.to),
      addedById: userId,
    },
    select: periodSelect,
  });
  return { item: periodDto(row) };
}

/** PUT …/labour-simple/period-payments/:id */
export async function updatePeriodPayment(userId: string, projectId: string, id: string, input: PeriodPaymentInput) {
  await requirePermission(userId, projectId, WRITE);
  // any payment to a team head or person (older ones without a period get one now)
  const found = await prisma.contractorPayment.findFirst({ where: { id, projectId, measureId: null }, select: { id: true } });
  if (!found) throw new HttpError(404, "That entry is no longer there.");
  const row = await prisma.contractorPayment.update({
    where: { id },
    data: { contractorName: input.name.trim(), date: day(paidOn(input.to)), amount: input.amount, periodFrom: day(input.from), periodTo: day(input.to) },
    select: periodSelect,
  });
  return { item: periodDto(row) };
}

/** DELETE …/labour-simple/period-payments/:id: only a payment that was archived first */
export async function removePeriodPayment(userId: string, projectId: string, id: string) {
  await requirePermission(userId, projectId, WRITE);
  const { count } = await prisma.contractorPayment.deleteMany({ where: { id, projectId, ...gone } });
  if (count === 0) throw new HttpError(409, "Archive the payment first, then delete it from Archived.");
  return { ok: true };
}

/* ------------------------------------------------ team heads and individuals ------------------------------------------------ */
/*
 * The Attendance tab's list: everyone marked in attendance (a team head, or one person paid directly), billed or paid
 * from it, one row each by name (case and spacing ignored). Earned = their attendance amount; Billed = their bills (a
 * period's amount); Paid = their payments not tied to a subcontract work. What they are owed is their bills when they
 * have any, otherwise their attendance amount; To pay = owed − paid. Subcontractors live in the Subcontract tab.
 */

type DayLite = { contractorName: string; date: Date; totalAmount: Num; workers: { label: string }[] };
/** "One person" only when the day holds exactly that person; older days (several workers, or amounts only) are a team */
const isTeam = (d: DayLite) => d.workers.length !== 1 || keyOf(d.workers[0]!.label) !== keyOf(d.contractorName);

/** GET …/labour-simple/team: one row per team head or person, newest first */
export async function team(userId: string, projectId: string) {
  await requirePermission(userId, projectId, VIEW);
  const [days, subs, pays, bills] = await Promise.all([
    prisma.attendance.findMany({
      where: { projectId, ...live },
      select: { contractorName: true, date: true, totalAmount: true, workers: { select: { label: true } } },
    }),
    prisma.labourMeasure.findMany({ where: { projectId }, distinct: ["contractorName"], select: { contractorName: true } }),
    prisma.contractorPayment.findMany({ where: { projectId, ...live, measureId: null }, select: { contractorName: true, amount: true, date: true } }),
    prisma.labourBill.findMany({ where: { projectId, ...live }, select: { contractorName: true, amount: true, periodTo: true } }),
  ]);
  const subNames = new Set(subs.map((x) => keyOf(x.contractorName)));
  type Row = { name: string; kind: "team" | "one" | null; days: number; earned: number; billed: number; bills: number; paid: number; last: string };
  const rows = new Map<string, Row>();
  const rowOf = (name: string) => {
    const k = keyOf(name);
    let r = rows.get(k);
    if (!r) {
      r = { name: name.trim(), kind: null, days: 0, earned: 0, billed: 0, bills: 0, paid: 0, last: "" };
      rows.set(k, r);
    }
    return r;
  };
  for (const d of days) {
    const r = rowOf(d.contractorName);
    r.days += 1;
    r.earned += num(d.totalAmount);
    r.kind = r.kind === "team" || isTeam(d) ? "team" : "one";
    const ymd = ymdOf(d.date);
    if (ymd > r.last) r.last = ymd;
  }
  for (const b of bills) {
    const r = rowOf(b.contractorName);
    r.billed += num(b.amount);
    r.bills += 1;
    const ymd = ymdOf(b.periodTo);
    if (ymd > r.last) r.last = ymd;
  }
  for (const p of pays) {
    const k = keyOf(p.contractorName);
    if (subNames.has(k) && !rows.has(k)) continue; // a subcontractor's payment: shown in Subcontract
    const r = rowOf(p.contractorName);
    r.paid += num(p.amount);
    const ymd = ymdOf(p.date);
    if (ymd > r.last) r.last = ymd;
  }
  const items = [...rows.values()]
    .map((r) => {
      const owed = r.bills > 0 ? r.billed : r.earned; // bills when there are any, else the attendance amount
      return { ...r, earned: r2(r.earned), billed: r2(r.billed), paid: r2(r.paid), owed: r2(owed), toPay: r2(owed - r.paid) };
    })
    .sort((a, b) => (a.last === b.last ? a.name.localeCompare(b.name) : a.last < b.last ? 1 : -1));
  return {
    items,
    totals: {
      earned: r2(items.reduce((s, i) => s + i.earned, 0)),
      billed: r2(items.reduce((s, i) => s + i.billed, 0)),
      paid: r2(items.reduce((s, i) => s + i.paid, 0)),
      // still owed and paid ahead apart, so one person's advance never hides what another is owed
      toPay: r2(items.reduce((s, i) => s + Math.max(0, i.toPay), 0)),
      ahead: r2(items.reduce((s, i) => s + Math.max(0, -i.toPay), 0)),
    },
  };
}

/** GET …/labour-simple/team/person?name=: one row opened: their marked days and their payments, newest first */
export async function person(userId: string, projectId: string, name: string) {
  await requirePermission(userId, projectId, VIEW);
  const who = { projectId, contractorName: same(name), ...live };
  const [days, pays, bills] = await Promise.all([
    prisma.attendance.findMany({
      where: who,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 400,
      select: { date: true, taskId: true, totalAmount: true, task: { select: { work: true } }, workers: { select: { hours: true, otHours: true } } },
    }),
    prisma.contractorPayment.findMany({
      where: { ...who, measureId: null },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 1000,
      select: { id: true, date: true, amount: true, remark: true, periodFrom: true, periodTo: true, billId: true },
    }),
    prisma.labourBill.findMany({
      where: who,
      orderBy: [{ periodTo: "desc" }, { createdAt: "desc" }],
      take: 400,
      select: { id: true, periodFrom: true, periodTo: true, amount: true, note: true },
    }),
  ]);
  const payDto = (p: (typeof pays)[number]) => ({ id: p.id, date: ymdOf(p.date), amount: r2(num(p.amount)), remark: p.remark });
  return {
    days: days.map((d) => ({
      date: ymdOf(d.date),
      taskId: d.taskId,
      work: d.task?.work ?? "General",
      workers: d.workers.length,
      hours: r2(d.workers.reduce((s, w) => s + num(w.hours), 0)),
      otHours: r2(d.workers.reduce((s, w) => s + num(w.otHours), 0)),
      amount: r2(num(d.totalAmount)),
    })),
    // Each bill with the payments made against it, oldest payment first, and what is left on it
    bills: bills.map((b) => {
      const mine = pays.filter((p) => p.billId === b.id).reverse();
      const paid = r2(mine.reduce((s, p) => s + num(p.amount), 0));
      const amount = r2(num(b.amount));
      return { id: b.id, from: ymdOf(b.periodFrom), to: ymdOf(b.periodTo), amount, note: b.note, paid, left: r2(amount - paid), payments: mine.map(payDto) };
    }),
    // Payments not made against a bill (older ones from before bills, or an advance)
    payments: pays.filter((p) => !p.billId).map(payDto),
  };
}

/* ------------------------------------------------ bills ------------------------------------------------ */

async function liveBill(projectId: string, id: string) {
  const b = await prisma.labourBill.findFirst({ where: { id, projectId, ...live }, select: { id: true, contractorName: true } });
  if (!b) throw new HttpError(404, "That bill is no longer there.");
  return b;
}

/** POST …/labour-simple/bills: what a team head or person earned for From – To (a new name joins the list) */
export async function addBill(userId: string, projectId: string, input: BillInput) {
  await requirePermission(userId, projectId, WRITE);
  const row = await prisma.labourBill.create({
    data: { projectId, contractorName: input.name.trim(), periodFrom: day(input.from), periodTo: day(input.to), amount: input.amount, note: input.note, addedBy: await whoIs(userId) },
    select: { id: true },
  });
  return { id: row.id };
}

/** PUT …/labour-simple/bills/:id: change the period, the amount or the note */
export async function updateBill(userId: string, projectId: string, id: string, input: BillInput) {
  await requirePermission(userId, projectId, WRITE);
  await liveBill(projectId, id);
  await prisma.labourBill.update({ where: { id }, data: { periodFrom: day(input.from), periodTo: day(input.to), amount: input.amount, note: input.note } });
  return { ok: true };
}

/** POST …/labour-simple/bills/:id/archive and …/restore: the bill with the payments made against it */
export async function archiveBill(userId: string, projectId: string, id: string, archive: boolean) {
  await requirePermission(userId, projectId, WRITE);
  const at = archive ? new Date() : null;
  const [b] = await prisma.$transaction([
    prisma.labourBill.updateMany({ where: { id, projectId, ...(archive ? live : gone) }, data: { archivedAt: at } }),
    prisma.contractorPayment.updateMany({ where: { projectId, billId: id, ...(archive ? live : gone) }, data: { archivedAt: at } }),
  ]);
  if (b.count === 0) throw new HttpError(404, "That bill is no longer there.");
  return { ok: true };
}

/** POST …/labour-simple/bill-payments: pay against a bill, on a day */
export async function addBillPayment(userId: string, projectId: string, input: BillPaymentInput) {
  await requirePermission(userId, projectId, WRITE);
  const b = await liveBill(projectId, input.billId);
  const row = await prisma.contractorPayment.create({
    data: { projectId, contractorName: b.contractorName, date: day(input.date), amount: input.amount, remark: input.remark, billId: b.id, addedById: userId },
    select: { id: true },
  });
  return { id: row.id };
}

/** PUT …/labour-simple/bill-payments/:id: change the date, amount or note of a payment (on a bill or not) */
export async function updateBillPayment(userId: string, projectId: string, id: string, input: BillPaymentInput) {
  await requirePermission(userId, projectId, WRITE);
  const found = await prisma.contractorPayment.findFirst({ where: { id, projectId, ...live, measureId: null }, select: { id: true } });
  if (!found) throw new HttpError(404, "That payment is no longer there.");
  const b = await liveBill(projectId, input.billId);
  await prisma.contractorPayment.update({ where: { id }, data: { date: day(input.date), amount: input.amount, remark: input.remark, billId: b.id, contractorName: b.contractorName } });
  return { ok: true };
}

/** POST …/labour-simple/team/archive: the person with all their days and payments goes to Archived (counted nowhere) */
export async function archivePerson(userId: string, projectId: string, name: string) {
  await requirePermission(userId, projectId, WRITE);
  const now = new Date();
  const who = { projectId, contractorName: same(name), ...live };
  const [a, p, b] = await prisma.$transaction([
    prisma.attendance.updateMany({ where: who, data: { archivedAt: now } }),
    prisma.contractorPayment.updateMany({ where: { ...who, measureId: null }, data: { archivedAt: now } }),
    prisma.labourBill.updateMany({ where: who, data: { archivedAt: now } }),
  ]);
  if (a.count + p.count + b.count === 0) throw new HttpError(404, "Nothing of theirs is left to archive.");
  return { days: a.count, payments: p.count, bills: b.count };
}

/** POST …/labour-simple/team/restore: back on the list with every archived day and payment */
export async function restorePerson(userId: string, projectId: string, name: string) {
  await requirePermission(userId, projectId, WRITE);
  const who = { projectId, contractorName: same(name), ...gone };
  const [a, p, b] = await prisma.$transaction([
    prisma.attendance.updateMany({ where: who, data: { archivedAt: null } }),
    prisma.contractorPayment.updateMany({ where: { ...who, measureId: null }, data: { archivedAt: null } }),
    prisma.labourBill.updateMany({ where: who, data: { archivedAt: null } }),
  ]);
  return { days: a.count, payments: p.count, bills: b.count };
}

/** POST …/labour-simple/payments/:id/archive and …/restore: one payment (team or subcontract) */
export async function archivePayment(userId: string, projectId: string, id: string, archive: boolean) {
  await requirePermission(userId, projectId, WRITE);
  const { count } = await prisma.contractorPayment.updateMany({ where: { id, projectId, ...(archive ? live : gone) }, data: { archivedAt: archive ? new Date() : null } });
  if (count === 0) throw new HttpError(404, "That payment is no longer there.");
  return { ok: true };
}

/* ------------------------------------------------ subcontract ------------------------------------------------ */
/*
 * Each work given to a subcontractor: the whole quantity given, the rate, and "done till date" updates (the latest
 * counts). Its amount = done till date × rate, kept on the row so every total elsewhere stays right. Payments can be
 * for one work, or an advance (no work).
 */

type ProgressTx = Pick<typeof prisma, "labourProgress" | "labourMeasure">;
/** Keep a work's amount = its latest "done till date" × rate */
async function settleAmount(tx: ProgressTx, measureId: string) {
  const [m, last] = await Promise.all([
    tx.labourMeasure.findUnique({ where: { id: measureId }, select: { rate: true } }),
    tx.labourProgress.findFirst({ where: { measureId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: { done: true } }),
  ]);
  if (m) await tx.labourMeasure.update({ where: { id: measureId }, data: { amount: r2(num(last?.done) * num(m.rate)) } });
}

async function liveMeasure(projectId: string, id: string) {
  const m = await prisma.labourMeasure.findFirst({ where: { id, projectId, ...live }, select: { id: true, contractorName: true } });
  if (!m) throw new HttpError(404, "That work is no longer there.");
  return m;
}

/** GET …/labour-simple/subcontract: per subcontractor: their works (done till date, amount, paid, to pay) and payments */
export async function subcontract(userId: string, projectId: string) {
  await requirePermission(userId, projectId, VIEW);
  const [ms, pays] = await Promise.all([
    prisma.labourMeasure.findMany({
      where: { projectId, ...live },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: 2000,
      select: {
        id: true,
        contractorName: true,
        date: true,
        work: true,
        quantity: true,
        unit: true,
        rate: true,
        amount: true,
        note: true,
        progress: { orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { id: true, date: true, done: true } },
      },
    }),
    prisma.contractorPayment.findMany({
      where: { projectId, ...live },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { id: true, contractorName: true, date: true, amount: true, remark: true, measureId: true },
    }),
  ]);
  const workName = new Map(ms.map((m) => [m.id, m.work]));
  type Sub = { name: string; works: ReturnType<typeof workDto>[]; payments: { id: string; date: string; amount: number; remark: string; measureId: string | null; work: string | null }[] };
  const subs = new Map<string, Sub>();
  function workDto(m: (typeof ms)[number]) {
    const last = m.progress.at(-1);
    const amount = r2(num(m.amount));
    const paid = r2(pays.filter((p) => p.measureId === m.id).reduce((s, p) => s + num(p.amount), 0));
    return {
      id: m.id,
      date: ymdOf(m.date),
      work: m.work,
      unit: m.unit,
      rate: num(m.rate),
      total: num(m.quantity),
      done: last ? num(last.done) : 0,
      doneOn: last ? ymdOf(last.date) : null,
      amount,
      paid,
      toPay: r2(amount - paid),
      note: m.note,
      progress: m.progress.map((x) => ({ id: x.id, date: ymdOf(x.date), done: num(x.done) })),
    };
  }
  for (const m of ms) {
    const k = keyOf(m.contractorName);
    if (!subs.has(k)) subs.set(k, { name: m.contractorName.trim(), works: [], payments: [] });
    subs.get(k)!.works.push(workDto(m));
  }
  for (const p of pays) {
    const sub = subs.get(keyOf(p.contractorName));
    if (!sub) continue; // not a subcontractor: shown in Attendance
    sub.payments.push({ id: p.id, date: ymdOf(p.date), amount: r2(num(p.amount)), remark: p.remark, measureId: p.measureId, work: p.measureId ? (workName.get(p.measureId) ?? null) : null });
  }
  const people = [...subs.values()].map((x) => {
    const done = r2(x.works.reduce((s, w) => s + w.amount, 0));
    const paid = r2(x.payments.reduce((s, p) => s + p.amount, 0));
    return { ...x, done, paid, toPay: r2(done - paid) };
  });
  return {
    people,
    totals: {
      done: r2(people.reduce((s, x) => s + x.done, 0)),
      paid: r2(people.reduce((s, x) => s + x.paid, 0)),
      toPay: r2(people.reduce((s, x) => s + Math.max(0, x.toPay), 0)),
      ahead: r2(people.reduce((s, x) => s + Math.max(0, -x.toPay), 0)),
    },
  };
}

/** POST …/labour-simple/subcontract: a work given (whole quantity, rate), with how much is done already if any */
export async function addMeasure(userId: string, projectId: string, input: MeasureInput) {
  await requirePermission(userId, projectId, WRITE);
  const by = await whoIs(userId);
  const done = input.done ?? 0;
  const row = await prisma.$transaction(async (tx) => {
    const m = await tx.labourMeasure.create({
      data: { projectId, trade: "", contractorName: input.contractorName.trim(), date: day(input.date), work: input.work, quantity: input.quantity, unit: input.unit, rate: input.rate, amount: r2(done * input.rate), note: input.note, addedBy: by },
      select: { id: true },
    });
    if (done > 0) await tx.labourProgress.create({ data: { measureId: m.id, date: day(input.date), done, addedBy: by } });
    return m;
  });
  return { id: row.id };
}

/** PUT …/labour-simple/subcontract/:id: change the work, quantity given, unit, rate, date or note */
export async function updateMeasure(userId: string, projectId: string, id: string, input: MeasureInput) {
  await requirePermission(userId, projectId, WRITE);
  await liveMeasure(projectId, id);
  await prisma.$transaction(async (tx) => {
    await tx.labourMeasure.update({
      where: { id },
      data: { contractorName: input.contractorName.trim(), date: day(input.date), work: input.work, quantity: input.quantity, unit: input.unit, rate: input.rate, note: input.note },
    });
    await settleAmount(tx, id);
  });
  return { ok: true };
}

/** POST …/labour-simple/subcontract/:id/progress: "done till date" (the total finished so far) on a date */
export async function addProgress(userId: string, projectId: string, id: string, input: { date: string; done: number }) {
  await requirePermission(userId, projectId, WRITE);
  await liveMeasure(projectId, id);
  const by = await whoIs(userId);
  await prisma.$transaction(async (tx) => {
    await tx.labourProgress.create({ data: { measureId: id, date: day(input.date), done: input.done, addedBy: by } });
    await settleAmount(tx, id);
  });
  return { ok: true };
}

/** PUT …/labour-simple/progress/:id: correct one "done till date" update */
export async function updateProgress(userId: string, projectId: string, id: string, input: { date: string; done: number }) {
  await requirePermission(userId, projectId, WRITE);
  const p = await prisma.labourProgress.findFirst({ where: { id, measure: { projectId, ...live } }, select: { measureId: true } });
  if (!p) throw new HttpError(404, "That update is no longer there.");
  await prisma.$transaction(async (tx) => {
    await tx.labourProgress.update({ where: { id }, data: { date: day(input.date), done: input.done } });
    await settleAmount(tx, p.measureId);
  });
  return { ok: true };
}

/** A payment to a subcontractor: for one of their works, or an advance */
async function subPaymentData(projectId: string, input: SubPaymentInput) {
  let contractorName = input.name.trim();
  if (input.measureId) contractorName = (await liveMeasure(projectId, input.measureId)).contractorName;
  return { contractorName, date: day(input.date), amount: input.amount, measureId: input.measureId, remark: input.remark };
}

/** POST …/labour-simple/subcontract/payments */
export async function addSubPayment(userId: string, projectId: string, input: SubPaymentInput) {
  await requirePermission(userId, projectId, WRITE);
  const row = await prisma.contractorPayment.create({ data: { projectId, addedById: userId, ...(await subPaymentData(projectId, input)) }, select: { id: true } });
  return { id: row.id };
}

/** PUT …/labour-simple/subcontract/payments/:id */
export async function updateSubPayment(userId: string, projectId: string, id: string, input: SubPaymentInput) {
  await requirePermission(userId, projectId, WRITE);
  const found = await prisma.contractorPayment.findFirst({ where: { id, projectId, ...live }, select: { id: true } });
  if (!found) throw new HttpError(404, "That payment is no longer there.");
  await prisma.contractorPayment.update({ where: { id }, data: await subPaymentData(projectId, input) });
  return { ok: true };
}

/** POST …/labour-simple/subcontract/:id/archive and …/restore: one work, with the payments made for it */
export async function archiveMeasure(userId: string, projectId: string, id: string, archive: boolean) {
  await requirePermission(userId, projectId, WRITE);
  const at = archive ? new Date() : null;
  const [m] = await prisma.$transaction([
    prisma.labourMeasure.updateMany({ where: { id, projectId, ...(archive ? live : gone) }, data: { archivedAt: at } }),
    prisma.contractorPayment.updateMany({ where: { projectId, measureId: id, ...(archive ? live : gone) }, data: { archivedAt: at } }),
  ]);
  if (m.count === 0) throw new HttpError(404, "That work is no longer there.");
  return { ok: true };
}

/** POST …/labour-simple/subcontractors/archive and …/restore: a subcontractor with all their works and payments */
export async function archiveSubcontractor(userId: string, projectId: string, name: string, archive: boolean) {
  await requirePermission(userId, projectId, WRITE);
  const where = { projectId, contractorName: same(name), ...(archive ? live : gone) };
  const at = archive ? new Date() : null;
  const [m, p] = await prisma.$transaction([
    prisma.labourMeasure.updateMany({ where, data: { archivedAt: at } }),
    prisma.contractorPayment.updateMany({ where, data: { archivedAt: at } }),
  ]);
  if (archive && m.count + p.count === 0) throw new HttpError(404, "Nothing of theirs is left to archive.");
  return { works: m.count, payments: p.count };
}

/** DELETE …/labour-simple/subcontract/:id: only a work archived first (its "done till date" updates go with it) */
export async function removeMeasure(userId: string, projectId: string, id: string) {
  await requirePermission(userId, projectId, WRITE);
  const { count } = await prisma.labourMeasure.deleteMany({ where: { id, projectId, ...gone } });
  if (count === 0) throw new HttpError(409, "Archive the work first, then delete it from Archived.");
  return { ok: true };
}

/* ------------------------------------------------ archived ------------------------------------------------ */

/**
 * GET …/labour-simple/archived: what was archived, for the Archived list: whole people and subcontractors (nothing of
 * theirs left on the lists), and single payments and works archived on their own.
 */
export async function archived(userId: string, projectId: string) {
  await requirePermission(userId, projectId, VIEW);
  const [days, pays, ms, liveDays, livePays, liveMs, billsGone, liveBills] = await Promise.all([
    prisma.attendance.findMany({ where: { projectId, ...gone }, select: { contractorName: true, totalAmount: true } }),
    prisma.contractorPayment.findMany({
      where: { projectId, ...gone },
      orderBy: { archivedAt: "desc" },
      select: { id: true, contractorName: true, date: true, amount: true, periodFrom: true, periodTo: true, measureId: true, billId: true, measure: { select: { work: true } } },
    }),
    prisma.labourMeasure.findMany({ where: { projectId, ...gone }, orderBy: { archivedAt: "desc" }, select: { id: true, contractorName: true, work: true, amount: true } }),
    prisma.attendance.findMany({ where: { projectId, ...live }, distinct: ["contractorName"], select: { contractorName: true } }),
    prisma.contractorPayment.findMany({ where: { projectId, ...live }, distinct: ["contractorName"], select: { contractorName: true } }),
    prisma.labourMeasure.findMany({ where: { projectId, ...live }, distinct: ["contractorName"], select: { contractorName: true } }),
    prisma.labourBill.findMany({ where: { projectId, ...gone }, orderBy: { archivedAt: "desc" }, select: { id: true, contractorName: true, periodFrom: true, periodTo: true, amount: true } }),
    prisma.labourBill.findMany({ where: { projectId, ...live }, distinct: ["contractorName"], select: { contractorName: true } }),
  ]);
  const liveSub = new Set(liveMs.map((m) => keyOf(m.contractorName)));
  const subNames = new Set([...liveSub, ...ms.map((m) => keyOf(m.contractorName))]);
  const liveTeam = new Set([...liveDays, ...livePays, ...liveBills].map((x) => keyOf(x.contractorName)));
  // payments archived together with their bill or work come back with it, so they are not listed on their own
  const goneBills = new Set(billsGone.map((b) => b.id));
  const goneWorks = new Set(ms.map((m) => m.id));

  // whole people: archived days, bills or payments, nothing left on the Attendance list
  type Gone = { name: string; days: number; bills: number; payments: number; earned: number; billed: number; paid: number };
  const people = new Map<string, Gone>();
  const goneOf = (name: string) => {
    const k = keyOf(name);
    const r = people.get(k) ?? { name: name.trim(), days: 0, bills: 0, payments: 0, earned: 0, billed: 0, paid: 0 };
    people.set(k, r);
    return r;
  };
  for (const d of days) {
    if (liveTeam.has(keyOf(d.contractorName))) continue;
    const r = goneOf(d.contractorName);
    r.days += 1;
    r.earned = r2(r.earned + num(d.totalAmount));
  }
  const bills: { id: string; name: string; from: string; to: string; amount: number }[] = [];
  for (const b of billsGone) {
    if (liveTeam.has(keyOf(b.contractorName))) {
      bills.push({ id: b.id, name: b.contractorName.trim(), from: ymdOf(b.periodFrom), to: ymdOf(b.periodTo), amount: r2(num(b.amount)) });
      continue;
    }
    const r = goneOf(b.contractorName);
    r.bills += 1;
    r.billed = r2(r.billed + num(b.amount));
  }
  // whole subcontractors: archived works, none left on the Subcontract list
  const subs = new Map<string, { name: string; works: number; payments: number; done: number; paid: number }>();
  for (const m of ms) {
    const k = keyOf(m.contractorName);
    if (liveSub.has(k)) continue;
    const r = subs.get(k) ?? { name: m.contractorName.trim(), works: 0, payments: 0, done: 0, paid: 0 };
    r.works += 1;
    r.done = r2(r.done + num(m.amount));
    subs.set(k, r);
  }
  const payments: { id: string; name: string; kind: "team" | "sub"; date: string; from: string; to: string; amount: number; work: string | null }[] = [];
  for (const p of pays) {
    const k = keyOf(p.contractorName);
    if (subNames.has(k) && subs.has(k)) {
      subs.get(k)!.payments += 1;
      subs.get(k)!.paid = r2(subs.get(k)!.paid + num(p.amount));
      continue;
    }
    if (!p.measureId && !subNames.has(k) && !liveTeam.has(k)) {
      const r = goneOf(p.contractorName);
      r.payments += 1;
      r.paid = r2(r.paid + num(p.amount));
      continue;
    }
    if ((p.billId && goneBills.has(p.billId)) || (p.measureId && goneWorks.has(p.measureId))) continue;
    payments.push({
      id: p.id,
      name: p.contractorName.trim(),
      kind: subNames.has(k) ? "sub" : "team",
      date: ymdOf(p.date),
      from: p.periodFrom ? ymdOf(p.periodFrom) : "",
      to: p.periodTo ? ymdOf(p.periodTo) : "",
      amount: r2(num(p.amount)),
      work: p.measure?.work ?? null,
    });
  }
  const works = ms.filter((m) => liveSub.has(keyOf(m.contractorName))).map((m) => ({ id: m.id, name: m.contractorName.trim(), work: m.work, amount: r2(num(m.amount)) }));
  return { people: [...people.values()], subcontractors: [...subs.values()], payments, works, bills };
}

/**
 * POST …/labour-simple/archived/delete: delete for good, in one transaction. Only rows already archived are removed;
 * anything still on a list is never touched.
 */
export async function deleteArchived(userId: string, projectId: string, input: ArchivedDelete) {
  await requirePermission(userId, projectId, WRITE);
  const counts = await prisma.$transaction(async (tx) => {
    let days = 0;
    let payments = 0;
    let works = 0;
    for (const n of input.people) {
      days += (await tx.attendance.deleteMany({ where: { projectId, contractorName: same(n), ...gone } })).count; // workers cascade
      payments += (await tx.contractorPayment.deleteMany({ where: { projectId, contractorName: same(n), measureId: null, ...gone } })).count;
      await tx.labourBill.deleteMany({ where: { projectId, contractorName: same(n), ...gone } });
    }
    if (input.bills.length) {
      payments += (await tx.contractorPayment.deleteMany({ where: { projectId, billId: { in: input.bills }, ...gone } })).count;
      await tx.labourBill.deleteMany({ where: { projectId, id: { in: input.bills }, ...gone } });
    }
    for (const n of input.subcontractors) {
      payments += (await tx.contractorPayment.deleteMany({ where: { projectId, contractorName: same(n), ...gone } })).count;
      works += (await tx.labourMeasure.deleteMany({ where: { projectId, contractorName: same(n), ...gone } })).count; // updates cascade
    }
    if (input.works.length) {
      payments += (await tx.contractorPayment.deleteMany({ where: { projectId, measureId: { in: input.works }, ...gone } })).count;
      works += (await tx.labourMeasure.deleteMany({ where: { projectId, id: { in: input.works }, ...gone } })).count;
    }
    if (input.payments.length) payments += (await tx.contractorPayment.deleteMany({ where: { projectId, id: { in: input.payments }, ...gone } })).count;
    return { days, payments, works };
  });
  return counts;
}

/* ------------------------------------------------ rate comparison ------------------------------------------------ */

/**
 * GET …/labour-simple/compare: one work between two dates: what our own labour cost (attendance on it, hours and OT
 * included), the quantity done (kept on the work item), and every subcontractor's quote, with what each was paid.
 */
export async function compare(userId: string, projectId: string, q: { taskId?: string; from: string; to: string }) {
  await requirePermission(userId, projectId, VIEW);
  checkRange(q.from, q.to);
  if (!q.taskId) throw new HttpError(400, "Pick a work.");
  const task = await prisma.task.findFirst({ where: { id: q.taskId, projectId }, select: { id: true, work: true, area: true } });
  if (!task) throw new HttpError(404, "That work is no longer there.");
  const [att, quotes] = await Promise.all([
    prisma.attendance.findMany({ where: { projectId, ...live, taskId: task.id, date: { gte: day(q.from), lte: day(q.to) } }, select: { totalAmount: true, workers: { select: { hours: true, otHours: true } } } }),
    prisma.labourQuote.findMany({ where: { projectId, taskId: task.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const paid = quotes.length
    ? await prisma.contractorPayment.groupBy({ by: ["contractorName"], where: { projectId, ...live, OR: quotes.map((x) => ({ contractorName: same(x.name) })) }, _sum: { amount: true } })
    : [];
  const paidTo = (n: string) => r2(paid.filter((g) => g.contractorName.trim().toLowerCase() === n.trim().toLowerCase()).reduce((s, g) => s + num(g._sum.amount), 0));
  return {
    work: { id: task.id, title: task.work },
    quantity: task.area,
    inHouse: {
      cost: r2(att.reduce((s, a) => s + num(a.totalAmount), 0)),
      workerDays: att.reduce((s, a) => s + a.workers.length, 0),
      hours: r2(att.reduce((s, a) => s + a.workers.reduce((t, w) => t + num(w.hours), 0), 0)),
      otHours: r2(att.reduce((s, a) => s + a.workers.reduce((t, w) => t + num(w.otHours), 0), 0)),
    },
    quotes: quotes.map((x) => ({ id: x.id, name: x.name, rate: num(x.rate), unit: x.unit, paid: paidTo(x.name) })),
  };
}

/**
 * GET …/labour-simple/rates: the Rate comparison table. Every work with the quantity done and the contractor rate
 * (both kept on the work item), and what our own labour cost on it between two dates (its attendance, hours and OT
 * included). The page works out the contractor cost, our labour rate per unit and the difference.
 */
export async function rateTable(userId: string, projectId: string, q: { from: string; to: string }) {
  await requirePermission(userId, projectId, VIEW);
  checkRange(q.from, q.to);
  const [tasks, sums] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, work: true, area: true, contractorRate: true } }),
    prisma.attendance.groupBy({ by: ["taskId"], where: { projectId, ...live, taskId: { not: null }, date: { gte: day(q.from), lte: day(q.to) } }, _sum: { totalAmount: true }, _count: { _all: true } }),
  ]);
  return {
    items: tasks.map((t) => {
      const s = sums.find((x) => x.taskId === t.id);
      return { id: t.id, title: t.work, quantity: t.area, contractorRate: t.contractorRate, labourCost: r2(num(s?._sum.totalAmount)), days: s?._count._all ?? 0 };
    }),
  };
}

/** PUT …/labour-simple/works/:taskId/rate: the quantity done and the contractor rate of one work */
export async function setWorkRate(userId: string, projectId: string, taskId: string, input: { quantity: number; contractorRate: number }) {
  await requirePermission(userId, projectId, WRITE);
  await assertTask(projectId, taskId);
  await prisma.task.update({ where: { id: taskId }, data: { area: input.quantity, contractorRate: input.contractorRate } });
  return { ok: true };
}

/** PUT …/labour-simple/works/:taskId/quantity: how much of the work was done (sqft…), for the per-unit figures */
export async function setQuantity(userId: string, projectId: string, taskId: string, quantity: number) {
  await requirePermission(userId, projectId, WRITE);
  await assertTask(projectId, taskId);
  await prisma.task.update({ where: { id: taskId }, data: { area: quantity } });
  return { ok: true };
}

export async function addQuote(userId: string, projectId: string, taskId: string, input: { name: string; rate: number; unit: string }) {
  await requirePermission(userId, projectId, WRITE);
  await assertTask(projectId, taskId);
  const row = await prisma.labourQuote.create({ data: { projectId, taskId, name: input.name.trim(), rate: input.rate, unit: input.unit } });
  return { id: row.id };
}

export async function updateQuote(userId: string, projectId: string, id: string, input: { name: string; rate: number; unit: string }) {
  await requirePermission(userId, projectId, WRITE);
  const found = await prisma.labourQuote.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!found) throw new HttpError(404, "That quote is no longer there.");
  await prisma.labourQuote.update({ where: { id }, data: { name: input.name.trim(), rate: input.rate, unit: input.unit } });
  return { ok: true };
}

export async function removeQuote(userId: string, projectId: string, id: string) {
  await requirePermission(userId, projectId, WRITE);
  const found = await prisma.labourQuote.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!found) throw new HttpError(404, "That quote is no longer there.");
  await prisma.labourQuote.delete({ where: { id } });
  return { ok: true };
}