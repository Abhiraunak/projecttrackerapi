import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { drawingUrls } from "../../lib/cloudinary.js";
import { dayKeyIn } from "../punches/punch.calc.js";
/*
 * The simple Labour section, on the tables already there (attendance with hours and OT, contractor payments, contract
 * work, work items) plus subcontractor quotes. Everything can be changed at any time: these routes don't use the old
 * "settled week" lock. Seeing needs "View attendance"; changing needs "Mark attendance".
 */
const VIEW = "attendance.view";
const WRITE = "attendance.write";
const num = (v) => (v ? v.toNumber() : 0);
const r2 = (n) => Math.round(n * 100) / 100;
const day = (s) => new Date(`${s}T00:00:00Z`);
const ymdOf = (d) => d.toISOString().slice(0, 10);
const today = () => dayKeyIn(new Date());
const same = (name) => ({ equals: name.trim(), mode: "insensitive" });
const taskOf = (taskId) => (taskId ? taskId : null);
const notFuture = (date) => {
    if (date > today())
        throw new HttpError(400, "The date can't be in the future.");
};
const checkRange = (from, to) => {
    if (from > to)
        throw new HttpError(400, "The From date is after the To date.");
};
const whoIs = async (userId) => {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    return u?.name || u?.email || "Someone";
};
async function assertTask(projectId, taskId) {
    if (!taskId)
        return;
    const t = await prisma.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } });
    if (!t)
        throw new HttpError(400, "That work is no longer there.");
}
/** A worker's pay for the day: hours × rate + OT hours × OT rate; an old day kept only as an amount keeps it */
function payOf(w) {
    if (w.fixed !== null && w.hours === 0 && w.otHours === 0 && w.rate === 0)
        return r2(w.fixed);
    return r2(w.hours * w.rate + w.otHours * w.otRate);
}
const workerDto = (w) => {
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
const workerSelect = { label: true, amount: true, position: true, hours: true, otHours: true, hourlyRate: true, otRate: true };
/* ------------------------------------------------ attendance ------------------------------------------------ */
/** GET …/labour-simple/day: one contractor's crew on one work on one day, and the last crew before it ("Same as yesterday") */
export async function getDay(userId, projectId, q) {
    await requirePermission(userId, projectId, VIEW);
    const taskId = taskOf(q.taskId);
    const where = { projectId, contractorName: same(q.contractor), taskId };
    const [rows, before] = await Promise.all([
        prisma.attendance.findMany({ where: { ...where, date: day(q.date) }, orderBy: { createdAt: "asc" }, select: { extras: true, workers: { select: workerSelect, orderBy: { position: "asc" } } } }),
        prisma.attendance.findFirst({ where: { ...where, date: { lt: day(q.date) } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: { date: true, workers: { select: workerSelect, orderBy: { position: "asc" } } } }),
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
export async function saveDay(userId, projectId, input) {
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
        if (existing.length)
            await tx.attendance.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } }); // workers cascade
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
                    }
                    else
                        sum += num(lw.amount);
                }
                if (changed)
                    await tx.attendance.update({ where: { id: a.id }, data: { totalAmount: r2(sum + num(a.extras)) } });
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
export async function copyDay(userId, projectId, input) {
    await requirePermission(userId, projectId, WRITE);
    await assertTask(projectId, input.taskId);
    const where = { projectId, contractorName: same(input.contractorName), taskId: input.taskId };
    const source = await prisma.attendance.findMany({
        where: { ...where, date: day(input.date) },
        orderBy: { createdAt: "asc" },
        select: { trade: true, contractorName: true, workers: { select: workerSelect, orderBy: { position: "asc" } } },
    });
    const workers = source.flatMap((r) => r.workers);
    if (workers.length === 0)
        throw new HttpError(400, "This day has nobody marked yet. Fill it first, then copy it.");
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
                    contractorName: source[0].contractorName,
                    trade: source[0].trade,
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
export async function dayTotals(userId, projectId, q) {
    await requirePermission(userId, projectId, VIEW);
    checkRange(q.from, q.to);
    const rows = await prisma.attendance.groupBy({
        by: ["date"],
        where: {
            projectId,
            date: { gte: day(q.from), lte: day(q.to) },
            ...(q.taskId !== undefined ? { taskId: taskOf(q.taskId) } : {}),
            ...(q.contractor ? { contractorName: same(q.contractor) } : {}),
        },
        _sum: { totalAmount: true },
    });
    return { days: rows.map((r) => ({ date: ymdOf(r.date), total: r2(num(r._sum.totalAmount)) })) };
}
/** GET …/labour-simple/records: every saved day in a range (one work, one contractor, or all), newest first */
export async function records(userId, projectId, q) {
    await requirePermission(userId, projectId, VIEW);
    checkRange(q.from, q.to);
    const rows = await prisma.attendance.findMany({
        where: {
            projectId,
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
export async function works(userId, projectId) {
    await requirePermission(userId, projectId, VIEW);
    const [tasks, sums] = await Promise.all([
        prisma.task.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, work: true, area: true } }),
        prisma.attendance.groupBy({ by: ["taskId"], where: { projectId }, _sum: { totalAmount: true } }),
    ]);
    const cost = (taskId) => r2(num(sums.find((s) => s.taskId === taskId)?._sum.totalAmount));
    return { items: tasks.map((t) => ({ id: t.id, title: t.work, quantity: t.area, cost: cost(t.id) })), general: cost(null) };
}
/** POST …/labour-simple/works: add a work by name (the same name again gives the one already there) */
export async function addWork(userId, projectId, title) {
    await requirePermission(userId, projectId, WRITE);
    const work = title.replace(/\s+/g, " ").trim();
    const found = await prisma.task.findFirst({ where: { projectId, work: same(work) }, select: { id: true, work: true } });
    if (found)
        return { item: { id: found.id, title: found.work } };
    const last = await prisma.task.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
    const start = day(today());
    const created = await prisma.task.create({
        data: { projectId, work, area: 0, contractorRate: 0, inHouseRate: 0, stipulated: 0, startDate: start, endDate: new Date(start.getTime() + 30 * 864e5), position: (last?.position ?? -1) + 1 },
        select: { id: true, work: true },
    });
    return { item: { id: created.id, title: created.work } };
}
/** PATCH …/labour-simple/works/:taskId: rename; every day marked under it stays with it */
export async function renameWork(userId, projectId, taskId, title) {
    await requirePermission(userId, projectId, WRITE);
    await assertTask(projectId, taskId);
    await prisma.task.update({ where: { id: taskId }, data: { work: title.replace(/\s+/g, " ").trim() } });
    return { ok: true };
}
/** GET …/labour-simple/people: everyone named in attendance, payments, contract work and quotes */
export async function people(userId, projectId) {
    await requirePermission(userId, projectId, VIEW);
    const [a, p, m, q] = await Promise.all([
        prisma.attendance.findMany({ where: { projectId }, distinct: ["contractorName"], select: { contractorName: true }, orderBy: { date: "desc" } }),
        prisma.contractorPayment.findMany({ where: { projectId }, distinct: ["contractorName"], select: { contractorName: true } }),
        prisma.labourMeasure.findMany({ where: { projectId }, distinct: ["contractorName"], select: { contractorName: true } }),
        prisma.labourQuote.findMany({ where: { projectId }, distinct: ["name"], select: { name: true } }),
    ]);
    const seen = new Map();
    for (const n of [...a.map((x) => x.contractorName), ...m.map((x) => x.contractorName), ...p.map((x) => x.contractorName), ...q.map((x) => x.name)]) {
        const k = n.trim().toLowerCase();
        if (k && !seen.has(k))
            seen.set(k, n.trim());
    }
    return { contractors: [...new Set(a.map((x) => x.contractorName.trim()))], everyone: [...seen.values()] };
}
/* ------------------------------------------------ payments ------------------------------------------------ */
const kindOf = (format) => (format === "pdf" ? "pdf" : "image");
const paymentDto = (p) => ({
    id: p.id,
    date: ymdOf(p.date),
    amount: r2(num(p.amount)),
    remark: p.remark,
    contractorName: p.contractorName,
    receiptUrl: p.proofId && p.proofVersion !== null && p.proofFormat
        ? drawingUrls({ publicId: p.proofId, version: p.proofVersion, format: p.proofFormat, kind: kindOf(p.proofFormat) }).openUrl
        : null,
});
/**
 * GET …/labour-simple/statement: one person between two dates: what they earned (attendance + contract work), every
 * payment made to them, and what is left; plus the same for all time, so nothing older is forgotten.
 */
export async function statement(userId, projectId, q) {
    await requirePermission(userId, projectId, VIEW);
    checkRange(q.from, q.to);
    const who = { projectId, contractorName: same(q.person) };
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
export async function updatePayment(userId, projectId, id, input) {
    await requirePermission(userId, projectId, WRITE);
    notFuture(input.date);
    const p = await prisma.contractorPayment.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!p)
        throw new HttpError(404, "That payment is no longer there.");
    await prisma.contractorPayment.update({ where: { id }, data: { contractorName: input.contractorName.trim(), date: day(input.date), amount: input.amount, remark: input.remark } });
    return { ok: true };
}
/* ------------------------------------------------ paid for a period ------------------------------------------------ */
/*
 * A payment with the days it covers (Attendance tab). Kept as an ordinary contractor payment, so it also counts in the
 * Payments tab: dated on the To day, or today when the period runs into the future.
 */
const periodSelect = { id: true, contractorName: true, amount: true, periodFrom: true, periodTo: true };
const periodDto = (p) => ({ id: p.id, name: p.contractorName, from: p.periodFrom ? ymdOf(p.periodFrom) : "", to: p.periodTo ? ymdOf(p.periodTo) : "", amount: r2(num(p.amount)) });
const paidOn = (to) => (to > today() ? today() : to);
/** GET …/labour-simple/period-payments: every "paid for a period" entry, latest period first */
export async function periodPayments(userId, projectId) {
    await requirePermission(userId, projectId, VIEW);
    const rows = await prisma.contractorPayment.findMany({
        where: { projectId, periodFrom: { not: null } },
        orderBy: [{ periodTo: "desc" }, { createdAt: "desc" }],
        take: 1000,
        select: periodSelect,
    });
    const items = rows.map(periodDto);
    return { items, total: r2(items.reduce((s, i) => s + i.amount, 0)) };
}
/** POST …/labour-simple/period-payments */
export async function addPeriodPayment(userId, projectId, input) {
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
export async function updatePeriodPayment(userId, projectId, id, input) {
    await requirePermission(userId, projectId, WRITE);
    const found = await prisma.contractorPayment.findFirst({ where: { id, projectId, periodFrom: { not: null } }, select: { id: true } });
    if (!found)
        throw new HttpError(404, "That entry is no longer there.");
    const row = await prisma.contractorPayment.update({
        where: { id },
        data: { contractorName: input.name.trim(), date: day(paidOn(input.to)), amount: input.amount, periodFrom: day(input.from), periodTo: day(input.to) },
        select: periodSelect,
    });
    return { item: periodDto(row) };
}
/** DELETE …/labour-simple/period-payments/:id (only these entries; other payments are untouched) */
export async function removePeriodPayment(userId, projectId, id) {
    await requirePermission(userId, projectId, WRITE);
    const { count } = await prisma.contractorPayment.deleteMany({ where: { id, projectId, periodFrom: { not: null } } });
    if (count === 0)
        throw new HttpError(404, "That entry is no longer there.");
    return { ok: true };
}
const measureDto = (m) => ({ id: m.id, contractorName: m.contractorName, date: ymdOf(m.date), work: m.work, quantity: num(m.quantity), unit: m.unit, rate: num(m.rate), amount: r2(num(m.amount)), note: m.note });
/** GET …/labour-simple/subcontract: every contract work entry, and per subcontractor: work done, paid, still to pay */
export async function subcontract(userId, projectId) {
    await requirePermission(userId, projectId, VIEW);
    const rows = await prisma.labourMeasure.findMany({ where: { projectId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 2000 });
    const items = rows.map(measureDto);
    const names = [...new Map(items.map((i) => [i.contractorName.trim().toLowerCase(), i.contractorName.trim()])).values()];
    const paid = names.length
        ? await prisma.contractorPayment.groupBy({ by: ["contractorName"], where: { projectId, OR: names.map((n) => ({ contractorName: same(n) })) }, _sum: { amount: true } })
        : [];
    const people = names.map((n) => {
        const done = r2(items.filter((i) => i.contractorName.trim().toLowerCase() === n.toLowerCase()).reduce((s, i) => s + i.amount, 0));
        const p = r2(paid.filter((g) => g.contractorName.trim().toLowerCase() === n.toLowerCase()).reduce((s, g) => s + num(g._sum.amount), 0));
        return { name: n, done, paid: p, toPay: r2(done - p) };
    });
    return { items, people, totals: { done: r2(people.reduce((s, x) => s + x.done, 0)), paid: r2(people.reduce((s, x) => s + x.paid, 0)), toPay: r2(people.reduce((s, x) => s + x.toPay, 0)) } };
}
export async function addMeasure(userId, projectId, input) {
    await requirePermission(userId, projectId, WRITE);
    notFuture(input.date);
    const row = await prisma.labourMeasure.create({
        data: { projectId, trade: "", contractorName: input.contractorName.trim(), date: day(input.date), work: input.work, quantity: input.quantity, unit: input.unit, rate: input.rate, amount: r2(input.quantity * input.rate), note: input.note, addedBy: await whoIs(userId) },
    });
    return { item: measureDto(row) };
}
export async function updateMeasure(userId, projectId, id, input) {
    await requirePermission(userId, projectId, WRITE);
    notFuture(input.date);
    const found = await prisma.labourMeasure.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!found)
        throw new HttpError(404, "That entry is no longer there.");
    const row = await prisma.labourMeasure.update({
        where: { id },
        data: { contractorName: input.contractorName.trim(), date: day(input.date), work: input.work, quantity: input.quantity, unit: input.unit, rate: input.rate, amount: r2(input.quantity * input.rate), note: input.note },
    });
    return { item: measureDto(row) };
}
export async function removeMeasure(userId, projectId, id) {
    await requirePermission(userId, projectId, WRITE);
    const found = await prisma.labourMeasure.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!found)
        throw new HttpError(404, "That entry is no longer there.");
    await prisma.labourMeasure.delete({ where: { id } });
    return { ok: true };
}
/* ------------------------------------------------ rate comparison ------------------------------------------------ */
/**
 * GET …/labour-simple/compare: one work between two dates: what our own labour cost (attendance on it, hours and OT
 * included), the quantity done (kept on the work item), and every subcontractor's quote, with what each was paid.
 */
export async function compare(userId, projectId, q) {
    await requirePermission(userId, projectId, VIEW);
    checkRange(q.from, q.to);
    if (!q.taskId)
        throw new HttpError(400, "Pick a work.");
    const task = await prisma.task.findFirst({ where: { id: q.taskId, projectId }, select: { id: true, work: true, area: true } });
    if (!task)
        throw new HttpError(404, "That work is no longer there.");
    const [att, quotes] = await Promise.all([
        prisma.attendance.findMany({ where: { projectId, taskId: task.id, date: { gte: day(q.from), lte: day(q.to) } }, select: { totalAmount: true, workers: { select: { hours: true, otHours: true } } } }),
        prisma.labourQuote.findMany({ where: { projectId, taskId: task.id }, orderBy: { createdAt: "asc" } }),
    ]);
    const paid = quotes.length
        ? await prisma.contractorPayment.groupBy({ by: ["contractorName"], where: { projectId, OR: quotes.map((x) => ({ contractorName: same(x.name) })) }, _sum: { amount: true } })
        : [];
    const paidTo = (n) => r2(paid.filter((g) => g.contractorName.trim().toLowerCase() === n.trim().toLowerCase()).reduce((s, g) => s + num(g._sum.amount), 0));
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
export async function rateTable(userId, projectId, q) {
    await requirePermission(userId, projectId, VIEW);
    checkRange(q.from, q.to);
    const [tasks, sums] = await Promise.all([
        prisma.task.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, work: true, area: true, contractorRate: true } }),
        prisma.attendance.groupBy({ by: ["taskId"], where: { projectId, taskId: { not: null }, date: { gte: day(q.from), lte: day(q.to) } }, _sum: { totalAmount: true }, _count: { _all: true } }),
    ]);
    return {
        items: tasks.map((t) => {
            const s = sums.find((x) => x.taskId === t.id);
            return { id: t.id, title: t.work, quantity: t.area, contractorRate: t.contractorRate, labourCost: r2(num(s?._sum.totalAmount)), days: s?._count._all ?? 0 };
        }),
    };
}
/** PUT …/labour-simple/works/:taskId/rate: the quantity done and the contractor rate of one work */
export async function setWorkRate(userId, projectId, taskId, input) {
    await requirePermission(userId, projectId, WRITE);
    await assertTask(projectId, taskId);
    await prisma.task.update({ where: { id: taskId }, data: { area: input.quantity, contractorRate: input.contractorRate } });
    return { ok: true };
}
/** PUT …/labour-simple/works/:taskId/quantity: how much of the work was done (sqft…), for the per-unit figures */
export async function setQuantity(userId, projectId, taskId, quantity) {
    await requirePermission(userId, projectId, WRITE);
    await assertTask(projectId, taskId);
    await prisma.task.update({ where: { id: taskId }, data: { area: quantity } });
    return { ok: true };
}
export async function addQuote(userId, projectId, taskId, input) {
    await requirePermission(userId, projectId, WRITE);
    await assertTask(projectId, taskId);
    const row = await prisma.labourQuote.create({ data: { projectId, taskId, name: input.name.trim(), rate: input.rate, unit: input.unit } });
    return { id: row.id };
}
export async function updateQuote(userId, projectId, id, input) {
    await requirePermission(userId, projectId, WRITE);
    const found = await prisma.labourQuote.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!found)
        throw new HttpError(404, "That quote is no longer there.");
    await prisma.labourQuote.update({ where: { id }, data: { name: input.name.trim(), rate: input.rate, unit: input.unit } });
    return { ok: true };
}
export async function removeQuote(userId, projectId, id) {
    await requirePermission(userId, projectId, WRITE);
    const found = await prisma.labourQuote.findFirst({ where: { id, projectId }, select: { id: true } });
    if (!found)
        throw new HttpError(404, "That quote is no longer there.");
    await prisma.labourQuote.delete({ where: { id } });
    return { ok: true };
}
//# sourceMappingURL=labourSimple.service.js.map