import { randomInt } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireAdmin } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { invoiceNo, planDelay, totalWithTax } from "./client.calc.js";
import { notifyDelay, notifyNewInstalment, notifyPaymentRequested, notifyProofDecided } from "./client.notify.js";
import { dayKey, num, projectSnapshot, proofDto, proofSelect } from "./client.snapshot.js";
import type { AddClientBody, DelayBody, InstalmentBody, InstalmentPatch, RecordPaymentBody } from "./client.schema.js";

const DAY = 86_400_000;
const asDay = (d: string) => new Date(`${d}T00:00:00.000Z`);
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const REASON_WORD = { MONSOON: "monsoon", FESTIVAL: "festival", NATURAL: "natural causes", OTHER: "other reasons" } as const;

/** A password that's easy to read out over the phone: no 0/O, 1/l/I */
function tempPassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join("");
}

/* --------------------------------- overview --------------------------------- */

/** The admin's client page: payments to check, and every ongoing project's money and schedule at a glance */
export async function clientOverview(adminId: string) {
  await requireAdmin(adminId);
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * DAY);

  const [projects, pending, received] = await Promise.all([
    prisma.project.findMany({
      where: { status: "ONGOING" },
      select: { id: true, title: true, _count: { select: { clients: true, instalments: true } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.paymentProof.findMany({
      where: { status: "PENDING" },
      select: { ...proofSelect, project: { select: { id: true, title: true } }, instalment: { select: { number: true, label: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.paymentProof.aggregate({ where: { status: "APPROVED", paidOn: { gte: monthAgo } }, _sum: { amount: true } }),
  ]);

  // Projects with a schedule get the full picture; the rest just show they still need one
  const rows = await Promise.all(
    projects.map(async (p) => {
      if (p._count.instalments === 0) {
        return { id: p.id, title: p.title, clients: p._count.clients, hasSchedule: false, contract: 0, paid: 0, dueNow: 0, overdue: 0, checking: 0, done: 0, daysBehind: 0, advance: "No advance" as const, delayDays: 0 };
      }
      const s = await projectSnapshot(prisma, p.id, now);
      return {
        id: p.id,
        title: p.title,
        clients: p._count.clients,
        hasSchedule: true,
        contract: s.payments.contract,
        paid: s.payments.paid,
        dueNow: s.payments.dueNow,
        overdue: s.payments.overdue,
        checking: s.payments.checking,
        done: s.schedule.done,
        daysBehind: s.schedule.daysBehind,
        advance: s.advance,
        delayDays: s.delayDays,
      };
    })
  );

  return {
    generatedAt: now.toISOString(),
    kpis: {
      toCheck: { count: pending.length, amount: pending.reduce((s, p) => s + num(p.amount), 0), oldest: pending[0]?.createdAt.toISOString() ?? null },
      overdue: { amount: rows.reduce((s, r) => s + r.overdue, 0), projects: rows.filter((r) => r.overdue > 0).length },
      waitingAdvance: rows.filter((r) => r.advance === "Waiting for advance").map((r) => r.title),
      received30: num(received._sum.amount),
      noSchedule: rows.filter((r) => !r.hasSchedule).length,
      noClient: rows.filter((r) => r.clients === 0).length,
    },
    toCheck: pending.map((p) => ({ ...proofDto(p), project: p.project, invoice: `${invoiceNo(p.instalment.number)} · ${p.instalment.label}` })),
    projects: rows,
  };
}

/** One project in full: its clients, payment schedule, payments and delays */
export async function clientProject(adminId: string, projectId: string) {
  await requireAdmin(adminId);
  const [snap, clients] = await Promise.all([
    projectSnapshot(prisma, projectId),
    prisma.projectClient.findMany({
      where: { projectId },
      select: { createdAt: true, user: { select: { id: true, email: true, name: true, createdAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { ...snap, clients: clients.map((c) => ({ id: c.user.id, email: c.user.email, name: c.user.name, linkedAt: c.createdAt.toISOString() })) };
}

/* ---------------------------------- clients ---------------------------------- */

/**
 * Gives a client access to a project. A new email gets a client account with a one-time password,
 * shown to the admin once (to send on WhatsApp or by email). Staff accounts can't be made clients.
 */
export async function addClient(adminId: string, projectId: string, { email, name }: AddClientBody) {
  await requireAdmin(adminId);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, title: true } });
  if (!project) throw new HttpError(404, "Project not found");

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (existing && existing.role !== "CLIENT") throw new HttpError(409, "That email belongs to a staff account. Use a different email for the client.");

  const password = existing ? null : tempPassword();
  const passwordHash = password ? await argon2.hash(password) : null;
  const userId = await prisma.$transaction(async (tx) => {
    let id = existing?.id;
    if (!id) {
      const created = await tx.user.create({ data: { email, name: name || null, role: "CLIENT", passwordHash: passwordHash! }, select: { id: true } });
      id = created.id;
    }
    await tx.projectClient.upsert({ where: { projectId_userId: { projectId, userId: id } }, create: { projectId, userId: id }, update: {} });
    await recordAudit(tx, { projectId, actorId: adminId, action: "client.added", entityType: "user", entityId: id, summary: `Gave ${email} client access to ${project.title}` });
    return id;
  });
  return { userId, email, password, isNew: password !== null };
}

export async function removeClient(adminId: string, projectId: string, userId: string) {
  await requireAdmin(adminId);
  const link = await prisma.projectClient.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { user: { select: { email: true } } } });
  if (!link) throw new HttpError(404, "That client isn't on this project");
  await prisma.$transaction(async (tx) => {
    await tx.projectClient.delete({ where: { projectId_userId: { projectId, userId } } });
    await recordAudit(tx, { projectId, actorId: adminId, action: "client.removed", entityType: "user", entityId: userId, summary: `Removed ${link.user.email}'s client access` });
  });
}

/** A new one-time password for a client who lost theirs. Signs them out everywhere. */
export async function resetClientPassword(adminId: string, userId: string) {
  await requireAdmin(adminId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true } });
  if (!user || user.role !== "CLIENT") throw new HttpError(404, "Client not found");
  const password = tempPassword();
  const passwordHash = await argon2.hash(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.refreshToken.deleteMany({ where: { userId } });
    await recordAudit(tx, { projectId: null, actorId: adminId, action: "client.password_reset", entityType: "user", entityId: userId, summary: `Reset the password of client ${user.email}` });
  });
  return { email: user.email, password };
}

/* --------------------------------- schedule --------------------------------- */

async function instalmentOrThrow(id: string) {
  const inst = await prisma.paymentInstalment.findUnique({
    where: { id },
    select: { id: true, projectId: true, number: true, label: true, kind: true, amount: true, taxPercent: true, project: { select: { title: true } }, proofs: { select: { status: true, amount: true } } },
  });
  if (!inst) throw new HttpError(404, "Payment not found");
  return inst;
}

/** Adds the advance or an instalment. The advance is asked for at once: work waits for it. */
export async function createInstalment(adminId: string, projectId: string, body: InstalmentBody) {
  await requireAdmin(adminId);
  if (body.kind === "INSTALMENT" && !body.dueDate && body.dueAtProgress === null) {
    throw new HttpError(400, "Give the instalment a due date or the work % that makes it due.");
  }
  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { title: true } });
    if (!project) throw new HttpError(404, "Project not found");
    const last = await tx.paymentInstalment.findFirst({ where: { projectId }, orderBy: { number: "desc" }, select: { number: true } });
    const number = (last?.number ?? 0) + 1;
    const row = await tx.paymentInstalment.create({
      data: {
        projectId,
        number,
        label: body.label,
        kind: body.kind,
        amount: body.amount,
        taxPercent: body.taxPercent,
        dueDate: body.dueDate ? asDay(body.dueDate) : null,
        dueAtProgress: body.dueAtProgress,
        note: body.note,
        requestedAt: body.kind === "ADVANCE" ? new Date() : null,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      projectId,
      actorId: adminId,
      action: "payment.scheduled",
      entityType: "project",
      entityId: row.id,
      summary: `Added ${invoiceNo(number)} · ${body.label}: ${inr(totalWithTax(body.amount, body.taxPercent))}${body.kind === "ADVANCE" ? " (advance, requested now)" : ""}`,
    });
    return { id: row.id, invoiceNo: invoiceNo(number), projectTitle: project.title };
  });

  const total = totalWithTax(body.amount, body.taxPercent);
  if (body.kind === "ADVANCE") {
    notifyPaymentRequested({ projectId, projectTitle: created.projectTitle, instalmentId: created.id, invoiceNo: created.invoiceNo, label: body.label, amount: total, isAdvance: true });
  } else {
    const when = [body.dueDate ? `due on ${asDay(body.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : null, body.dueAtProgress !== null ? `when work reaches ${body.dueAtProgress}%` : null].filter(Boolean).join(" or ");
    notifyNewInstalment({ projectId, projectTitle: created.projectTitle, invoiceNo: created.invoiceNo, label: body.label, amount: total, when });
  }
  return { id: created.id, invoiceNo: created.invoiceNo };
}

export async function updateInstalment(adminId: string, id: string, patch: InstalmentPatch) {
  await requireAdmin(adminId);
  const inst = await instalmentOrThrow(id);
  const paid = inst.proofs.filter((p) => p.status === "APPROVED").reduce((s, p) => s + num(p.amount), 0);
  const amount = patch.amount ?? num(inst.amount);
  const tax = patch.taxPercent ?? num(inst.taxPercent);
  if (paid > totalWithTax(amount, tax) + 0.5) throw new HttpError(400, `More than that has already been paid (${inr(paid)}).`);

  await prisma.$transaction(async (tx) => {
    await tx.paymentInstalment.update({
      where: { id },
      data: {
        ...(patch.label !== undefined && { label: patch.label }),
        ...(patch.kind !== undefined && { kind: patch.kind }),
        ...(patch.amount !== undefined && { amount: patch.amount }),
        ...(patch.taxPercent !== undefined && { taxPercent: patch.taxPercent }),
        ...(patch.dueDate !== undefined && { dueDate: patch.dueDate ? asDay(patch.dueDate) : null }),
        ...(patch.dueAtProgress !== undefined && { dueAtProgress: patch.dueAtProgress }),
        ...(patch.note !== undefined && { note: patch.note }),
      },
    });
    await recordAudit(tx, { projectId: inst.projectId, actorId: adminId, action: "payment.updated", entityType: "project", entityId: id, summary: `Changed ${invoiceNo(inst.number)} · ${patch.label ?? inst.label}` });
  });
}

/** Only a payment nobody has paid anything against can be removed */
export async function deleteInstalment(adminId: string, id: string) {
  await requireAdmin(adminId);
  const inst = await instalmentOrThrow(id);
  if (inst.proofs.some((p) => p.status !== "REJECTED")) throw new HttpError(409, "Payments have been made or sent for this one, so it can't be removed. Change its amount instead.");
  await prisma.$transaction(async (tx) => {
    await tx.paymentInstalment.delete({ where: { id } });
    await recordAudit(tx, { projectId: inst.projectId, actorId: adminId, action: "payment.removed", entityType: "project", entityId: id, summary: `Removed ${invoiceNo(inst.number)} · ${inst.label}` });
  });
}

/** "Ask for the due": the payment is due from now, and must be paid within the payment terms */
export async function requestPayment(adminId: string, id: string) {
  await requireAdmin(adminId);
  const inst = await instalmentOrThrow(id);
  await prisma.$transaction(async (tx) => {
    await tx.paymentInstalment.update({ where: { id }, data: { requestedAt: new Date() } });
    await recordAudit(tx, { projectId: inst.projectId, actorId: adminId, action: "payment.requested", entityType: "project", entityId: id, summary: `Asked the client to pay ${invoiceNo(inst.number)} · ${inst.label}` });
  });
  const paid = inst.proofs.filter((p) => p.status === "APPROVED").reduce((s, p) => s + num(p.amount), 0);
  notifyPaymentRequested({
    projectId: inst.projectId,
    projectTitle: inst.project.title,
    instalmentId: id,
    invoiceNo: invoiceNo(inst.number),
    label: inst.label,
    amount: Math.max(0, totalWithTax(num(inst.amount), num(inst.taxPercent)) - paid),
    isAdvance: inst.kind === "ADVANCE",
  });
}

/* ---------------------------------- payments ---------------------------------- */

/** Money received without a client upload (cash, a cheque handed over): counted as paid at once */
export async function recordPayment(adminId: string, instalmentId: string, body: RecordPaymentBody) {
  await requireAdmin(adminId);
  const inst = await instalmentOrThrow(instalmentId);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.paymentProof.create({
      data: {
        instalmentId,
        projectId: inst.projectId,
        uploadedById: adminId,
        amount: body.amount,
        paidOn: asDay(body.paidOn),
        mode: body.mode,
        reference: body.reference,
        note: body.note,
        status: "APPROVED",
        decidedById: adminId,
        decidedAt: new Date(),
      },
      select: proofSelect,
    });
    await recordAudit(tx, { projectId: inst.projectId, actorId: adminId, action: "payment.recorded", entityType: "project", entityId: created.id, summary: `Recorded ${inr(body.amount)} received for ${invoiceNo(inst.number)} · ${inst.label}` });
    return created;
  });
  notifyProofDecided({ projectId: inst.projectId, projectTitle: inst.project.title, invoiceNo: invoiceNo(inst.number), amount: body.amount, approved: true, note: "" });
  return proofDto(row);
}

/** Approve: the money arrived and counts as paid. Reject: it didn't (the client sees the note and can upload again). */
export async function decideProof(adminId: string, proofId: string, approve: boolean, note: string) {
  await requireAdmin(adminId);
  const proof = await prisma.paymentProof.findUnique({ where: { id: proofId }, select: { id: true, status: true, amount: true, projectId: true, project: { select: { title: true } }, instalment: { select: { number: true, label: true } } } });
  if (!proof) throw new HttpError(404, "Payment not found");
  if (proof.status !== "PENDING") throw new HttpError(409, "This payment has already been checked.");
  if (!approve && !note) throw new HttpError(400, "Say why, so the client knows what to fix.");

  const row = await prisma.$transaction(async (tx) => {
    // Only a still-pending proof changes: two admins clicking at once can't both decide it
    const changed = await tx.paymentProof.updateMany({
      where: { id: proofId, status: "PENDING" },
      data: { status: approve ? "APPROVED" : "REJECTED", decidedById: adminId, decidedAt: new Date(), decisionNote: note },
    });
    if (changed.count === 0) throw new HttpError(409, "This payment has already been checked.");
    await recordAudit(tx, {
      projectId: proof.projectId,
      actorId: adminId,
      action: approve ? "payment.approved" : "payment.rejected",
      entityType: "project",
      entityId: proofId,
      summary: `${approve ? "Approved" : "Rejected"} the client's payment of ${inr(num(proof.amount))} for ${invoiceNo(proof.instalment.number)} · ${proof.instalment.label}${note ? `: ${note}` : ""}`,
    });
    return tx.paymentProof.findUniqueOrThrow({ where: { id: proofId }, select: proofSelect });
  });
  notifyProofDecided({ projectId: proof.projectId, projectTitle: proof.project.title, invoiceNo: invoiceNo(proof.instalment.number), amount: num(proof.amount), approved: approve, note });
  return proofDto(row);
}

/* ----------------------------------- advance ----------------------------------- */

export async function setAdvanceOverride(adminId: string, projectId: string, override: boolean) {
  await requireAdmin(adminId);
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { advanceOverride: override } });
    await recordAudit(tx, {
      projectId,
      actorId: adminId,
      action: "payment.advance_override",
      entityType: "project",
      summary: override ? "Allowed work to start before the advance was paid" : "Work waits for the advance again",
    });
  });
}

/* ------------------------------------ delays ------------------------------------ */

/**
 * Work stopped for something nobody controls (monsoon, a festival, a flood). Moves the unfinished work and the
 * unpaid payment dates on or after `fromDate` later by `days`, in one go, and keeps a record the client sees.
 */
export async function addDelay(adminId: string, projectId: string, body: DelayBody) {
  await requireAdmin(adminId);
  const from = asDay(body.fromDate);

  const result = await prisma.$transaction(
    async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: {
          title: true,
          tasks: { select: { id: true, progress: true, startDate: true, endDate: true } },
          instalments: { select: { id: true, dueDate: true, amount: true, taxPercent: true, proofs: { select: { status: true, amount: true } } } },
        },
      });
      if (!project) throw new HttpError(404, "Project not found");

      const { taskMoves, paymentMoves } = planDelay(
        project.tasks,
        project.instalments.map((i) => ({
          id: i.id,
          dueDate: i.dueDate,
          paidUp: i.proofs.filter((p) => p.status === "APPROVED").reduce((s, p) => s + num(p.amount), 0) >= totalWithTax(num(i.amount), num(i.taxPercent)) - 0.5,
        })),
        from,
        body.days
      );

      for (const m of taskMoves) await tx.task.update({ where: { id: m.id }, data: { startDate: m.startDate, endDate: m.endDate } });
      for (const m of paymentMoves) await tx.paymentInstalment.update({ where: { id: m.id }, data: { dueDate: m.dueDate } });

      const delay = await tx.projectDelay.create({
        data: { projectId, reason: body.reason, title: body.title, note: body.note, fromDate: from, days: body.days, tasksMoved: taskMoves.length, paymentsMoved: paymentMoves.length, createdById: adminId },
        select: { id: true },
      });
      await recordAudit(tx, {
        projectId,
        actorId: adminId,
        action: "schedule.delayed",
        entityType: "project",
        entityId: delay.id,
        summary: `Extended the schedule by ${body.days} days from ${dayKey(from)} (${REASON_WORD[body.reason]}: ${body.title}). Moved ${taskMoves.length} work items and ${paymentMoves.length} payment dates.`,
      });
      return { id: delay.id, tasksMoved: taskMoves.length, paymentsMoved: paymentMoves.length, projectTitle: project.title };
    },
    { timeout: 30_000 } // a big project has many work items to move
  );
  notifyDelay({ projectId, projectTitle: result.projectTitle, title: body.title, days: body.days, reason: REASON_WORD[body.reason] });
  return { id: result.id, tasksMoved: result.tasksMoved, paymentsMoved: result.paymentsMoved };
}
