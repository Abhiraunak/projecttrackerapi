import type { Request, Response } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { hourlyRateOf, nameKey, STANDARD_HOURS } from "./attendance.hourly.js";
import { daysIn, monthSheet, statement } from "./attendance.month.calc.js";
import { monthQuerySchema, saveTeamSchema, teamQuerySchema } from "./attendance.team.schema.js";

/*
 * Each contractor's team on a project (names and day rates, for hourly attendance), and the month sheet with its
 * account. Seeing them needs "View attendance"; changing the team needs "Enter attendance".
 */

type Db = Prisma.TransactionClient | typeof prisma;
const uid = (req: Request<any, any, any, any>) => req.user!.sub;
const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The contractor's name as it is already spelled on this project ("sundar lal" → "Sundar Lal"), else as typed */
async function contractorSpelling(db: Db, projectId: string, raw: string) {
  const name = clean(raw);
  const found =
    (await db.labourTeamMember.findFirst({ where: { projectId, contractorName: { equals: name, mode: "insensitive" } }, select: { contractorName: true } })) ??
    (await db.attendance.findFirst({ where: { projectId, contractorName: { equals: name, mode: "insensitive" } }, select: { contractorName: true }, orderBy: { createdAt: "desc" } }));
  return found?.contractorName ?? name;
}

const memberDto = (m: { id: string; name: string; dayRate: { toNumber(): number }; active: boolean; position: number }) => ({
  id: m.id,
  name: m.name,
  dayRate: m.dayRate.toNumber(),
  hourlyRate: hourlyRateOf(m.dayRate.toNumber()),
  active: m.active,
});

const teamOf = (db: Db, projectId: string, contractorName: string) =>
  db.labourTeamMember.findMany({
    where: { projectId, contractorName: { equals: contractorName, mode: "insensitive" } },
    orderBy: [{ active: "desc" }, { position: "asc" }, { createdAt: "asc" }],
  });

/**
 * Saving hourly attendance keeps the team list up to date: anyone new joins it, a changed day rate is saved, and
 * someone marked as left who works again is back on it. Returns each name's member id, to link the day to the person.
 */
export async function syncTeam(db: Db, projectId: string, contractorRaw: string, workers: { label: string; dayRate?: number }[]) {
  const contractorName = await contractorSpelling(db, projectId, contractorRaw);
  const existing = await teamOf(db, projectId, contractorName);
  const byKey = new Map(existing.map((m) => [nameKey(m.name), m]));
  let position = existing.reduce((max, m) => Math.max(max, m.position), -1);
  const ids = new Map<string, string>();
  for (const w of workers) {
    const key = nameKey(w.label);
    if (!key || ids.has(key)) continue;
    const dayRate = w.dayRate ?? 0;
    const found = byKey.get(key);
    if (found) {
      if (found.dayRate.toNumber() !== dayRate || !found.active) await db.labourTeamMember.update({ where: { id: found.id }, data: { dayRate, active: true } });
      ids.set(key, found.id);
    } else {
      position += 1;
      const made = await db.labourTeamMember.create({ data: { projectId, contractorName, name: clean(w.label), dayRate, position }, select: { id: true } });
      ids.set(key, made.id);
    }
  }
  return ids;
}

/** GET /attendance/team?projectId=…&contractor=…: the team, people who left last */
export async function getTeam(req: Request, res: Response) {
  const { projectId, contractor } = teamQuerySchema.parse(req.query);
  await requirePermission(uid(req), projectId, "attendance.view");
  const members = await teamOf(prisma, projectId, clean(contractor));
  res.json({ contractorName: members[0]?.contractorName ?? clean(contractor), members: members.map(memberDto), standardHours: STANDARD_HOURS });
}

/** PUT /attendance/team: names, day rates, who left, and the order; people left out of the list are not touched */
export async function saveTeam(req: Request, res: Response) {
  const userId = uid(req);
  const { projectId, contractorName: raw, members } = saveTeamSchema.parse(req.body);
  await requirePermission(userId, projectId, "attendance.write");

  const seen = new Set<string>();
  for (const m of members) {
    const k = nameKey(m.name);
    if (seen.has(k)) throw new HttpError(400, `${clean(m.name)} is on the list twice.`);
    seen.add(k);
  }

  const saved = await prisma.$transaction(async (tx) => {
    const contractorName = await contractorSpelling(tx, projectId, raw);
    const existing = await teamOf(tx, projectId, contractorName);
    const byId = new Map(existing.map((m) => [m.id, m]));
    const byKey = new Map(existing.map((m) => [nameKey(m.name), m]));
    for (const [position, m] of members.entries()) {
      const name = clean(m.name);
      const found = (m.id ? byId.get(m.id) : undefined) ?? byKey.get(nameKey(name));
      if (found) await tx.labourTeamMember.update({ where: { id: found.id }, data: { name, dayRate: m.dayRate, active: m.active, position } });
      else await tx.labourTeamMember.create({ data: { projectId, contractorName, name, dayRate: m.dayRate, active: m.active, position } });
    }
    await recordAudit(tx, {
      projectId,
      actorId: userId,
      action: "attendance.team_saved",
      entityType: "attendance",
      entityId: projectId,
      summary: `Updated ${contractorName}'s team: ${members.filter((m) => m.active).length} working, ${members.filter((m) => !m.active).length} left`,
    });
    return teamOf(tx, projectId, contractorName);
  });
  res.json({ contractorName: saved[0]?.contractorName ?? clean(raw), members: saved.map(memberDto), standardHours: STANDARD_HOURS });
}

/**
 * GET /attendance/month?projectId=…&contractor=…&month=YYYY-MM: the month sheet (every labourer × every day, with
 * their hours, amount, OT and total) and the month's account (owed before + earned − paid = carried forward).
 * Without a contractor: the one entered most recently. Also lists the project's contractors, for the picker.
 */
export async function getMonth(req: Request, res: Response) {
  const { projectId, contractor, month } = monthQuerySchema.parse(req.query);
  await requirePermission(uid(req), projectId, "attendance.view");

  const recent = await prisma.attendance.findMany({ where: { projectId }, distinct: ["contractorName"], orderBy: { createdAt: "desc" }, select: { contractorName: true, trade: true }, take: 200 });
  const contractors = recent.map((r) => ({ name: r.contractorName, trade: r.trade }));
  const name = contractor ? clean(contractor) : contractors[0]?.name;
  if (!name) {
    res.json({ month, contractor: null, contractors, sheet: monthSheet(month, []), statement: statement(0, 0, 0, []) });
    return;
  }

  const from = new Date(`${month}-01T00:00:00Z`);
  const to = new Date(`${month}-${String(daysIn(month)).padStart(2, "0")}T00:00:00Z`);
  const who = { projectId, contractorName: { equals: name, mode: "insensitive" as const } };

  const [entries, earnedBefore, paidBefore, payments] = await Promise.all([
    prisma.attendance.findMany({ where: { ...who, date: { gte: from, lte: to } }, include: { workers: { orderBy: { position: "asc" } } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    prisma.attendance.aggregate({ where: { ...who, date: { lt: from } }, _sum: { totalAmount: true } }),
    prisma.contractorPayment.aggregate({ where: { ...who, date: { lt: from } }, _sum: { amount: true } }),
    prisma.contractorPayment.findMany({ where: { ...who, date: { gte: from, lte: to } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { id: true, date: true, amount: true, remark: true } }),
  ]);

  const n = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
  const sheet = monthSheet(
    month,
    entries.map((e) => ({
      date: ymd(e.date),
      extras: n(e.extras),
      totalAmount: n(e.totalAmount),
      workers: e.workers.map((w) => ({
        label: w.label,
        amount: n(w.amount),
        memberId: w.memberId,
        hours: w.hours === null ? null : n(w.hours),
        otHours: w.otHours === null ? null : n(w.otHours),
        hourlyRate: w.hourlyRate === null ? null : n(w.hourlyRate),
      })),
    }))
  );
  res.json({
    month,
    contractor: { name: entries[0]?.contractorName ?? name, trade: entries[0]?.trade ?? contractors.find((c) => c.name.toLowerCase() === name.toLowerCase())?.trade ?? "" },
    contractors,
    sheet,
    statement: statement(
      n(earnedBefore._sum.totalAmount),
      n(paidBefore._sum.amount),
      sheet.totals.total,
      payments.map((p) => ({ id: p.id, date: ymd(p.date), amount: n(p.amount), remark: p.remark }))
    ),
  });
}