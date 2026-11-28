import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { toDate } from "../../lib/dates.js";
import { recordAudit } from "../audit/audit.service.js";
import { getUserAccess, requireCan, requirePermission } from "../../lib/projectAccess.js";
import { numberOf, projectDto, summaryDto, taskDto, taskData } from "./projects.mapper.js";
import { spendByProject } from "./spend.service.js";
import {
  statusEnum,
  type CreateBody,
  type UpdateBody,
  type PatchProjectBody,
  type PatchTaskBody,
} from "./projects.schema.js";

const withTasks = { tasks: { orderBy: { position: "asc" } } } as const;
const uid = (req: Request<any, any, any, any>) => req.user!.sub;

/** Every project: access is company-wide, so anyone allowed to view projects sees all of them */
export async function list(req: Request, res: Response) {
  await requireCan(uid(req), "project.view");
  const status = statusEnum.safeParse(req.query.status);
  const projects = await prisma.project.findMany({
    where: { status: status.success ? status.data : { not: "ARCHIVED" } },
    include: { ...withTasks, _count: { select: { attendance: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const ids = projects.map((p) => p.id);
  // Total spend for each tile: the same sum as the project's Overview; and this person's pins
  const [spend, pins] = await Promise.all([
    spendByProject(ids),
    prisma.projectPin.findMany({ where: { userId: uid(req), projectId: { in: ids } }, select: { projectId: true } }),
  ]);
  const pinned = new Set(pins.map((x) => x.projectId));
  // Pinned projects first; otherwise the order stays (latest change first)
  const sorted = [...projects].sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
  res.json({ projects: sorted.map((p) => summaryDto(p, spend.get(p.id), pinned.has(p.id))) });
}

/** POST /projects/:id/pin and DELETE …/pin: pin a project to the top of this person's own dashboard */
export async function pin(req: Request<{ id: string }>, res: Response) {
  await requireCan(uid(req), "project.view");
  const { id } = req.params;
  if (!(await prisma.project.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, "That project is no longer there.");
  await prisma.projectPin.upsert({ where: { userId_projectId: { userId: uid(req), projectId: id } }, create: { userId: uid(req), projectId: id }, update: {} });
  res.json({ ok: true, pinned: true });
}
export async function unpin(req: Request<{ id: string }>, res: Response) {
  await requireCan(uid(req), "project.view");
  await prisma.projectPin.deleteMany({ where: { userId: uid(req), projectId: req.params.id } });
  res.json({ ok: true, pinned: false });
}

export async function create(req: Request<unknown, unknown, CreateBody>, res: Response) {
  const userId = uid(req);
  // "Create projects" (project.create) or "Overview" (project.manage) may start a project
  const access = await getUserAccess(userId);
  if (!access.permissions.includes("project.create") && !access.permissions.includes("project.manage"))
    throw new HttpError(403, "You don't have permission to create projects. Ask an admin.");
  const { title, projectCost, tasks } = req.body;

  const project = await prisma.project.create({
    data: { title, projectCost, ownerId: userId, tasks: { create: tasks.map((t, i) => taskData(t, i)) } },
    include: withTasks,
  });
  res.status(201).json({ project: projectDto(project) });
}

export async function getOne(req: Request<{ id: string }>, res: Response) {
  await requirePermission(uid(req), req.params.id, "project.view");
  const project = await prisma.project.findUniqueOrThrow({ where: { id: req.params.id }, include: withTasks });
  res.json({ project: projectDto(project) });
}

/** Full edit from the form: update existing work items, add new ones, delete removed ones, all or nothing. */
export async function update(req: Request<{ id: string }, unknown, UpdateBody>, res: Response) {
  const userId = uid(req);
  const { id } = req.params;
  const { title, projectCost, status, tasks } = req.body;
  await requirePermission(userId, id, "project.manage");

  const project = await prisma.$transaction(async (tx) => {
    const existingRows = await tx.task.findMany({ where: { projectId: id }, select: { id: true } });
    const existing = new Set(existingRows.map((t) => t.id));

    // Work items left out of the form are deleted; the rest are updated, and new ones added
    const keep = tasks.filter((t) => t.id && existing.has(t.id)).map((t) => t.id!);
    await tx.task.deleteMany({ where: { projectId: id, id: { notIn: keep } } });
    for (const [i, t] of tasks.entries()) {
      if (t.id && existing.has(t.id)) await tx.task.update({ where: { id: t.id }, data: taskData(t, i) });
      else await tx.task.create({ data: { ...taskData(t, i), projectId: id } });
    }

    return tx.project.update({ where: { id }, data: { title, projectCost, ...(status ? { status } : {}) }, include: withTasks });
  });

  res.json({ project: projectDto(project) });
}

export async function patchProject(req: Request<{ id: string }, unknown, PatchProjectBody>, res: Response) {
  const { id } = req.params;
  await requirePermission(uid(req), id, "project.manage");

  // The dates come as "2026-11-05"; the database needs real dates (null clears them, left out keeps them)
  const { startDate, endDate, number, ...rest } = req.body;

  // The project number: only an admin may change it, and two projects can't share one
  let numberData: { number: string | null } | Record<string, never> = {};
  if (number !== undefined) {
    const access = await getUserAccess(uid(req));
    if (!access.isAdmin) throw new HttpError(403, "Only an admin can change the project number.");
    const current = await prisma.project.findUnique({ where: { id }, select: { serialNo: true, number: true } });
    if (!current) throw new HttpError(404, "That project is no longer there.");
    const wanted = (number ?? "").trim().toUpperCase();
    const automatic = `PT-${String(current.serialNo).padStart(3, "0")}`;
    const value = wanted === "" || wanted === automatic ? null : wanted; // empty or its own PT-00N: back to automatic
    if (value) {
      // Taken by another project's own number, or matches another project's automatic PT-00N
      const auto = /^PT-0*(\d+)$/.exec(value);
      const clash = await prisma.project.findFirst({
        where: { id: { not: id }, OR: [{ number: value }, ...(auto ? [{ number: null, serialNo: Number(auto[1]) }] : [])] },
        select: { title: true },
      });
      if (clash) throw new HttpError(409, `${value} is already used by ${clash.title}.`);
    }
    numberData = { number: value };
  }
  const data = {
    ...rest,
    ...numberData,
    ...(startDate !== undefined && { startDate: startDate ? toDate(startDate) : null }),
    ...(endDate !== undefined && { endDate: endDate ? toDate(endDate) : null }),
  };
  const before = await prisma.project.findUnique({ where: { id }, select: { title: true, firmName: true, projectCost: true, status: true, serialNo: true, number: true } });
  const project = await prisma.project.update({ where: { id }, data, include: withTasks });

  // Into the activity log (Recent activity for admins): what changed, in words
  const inr = (v: unknown) => (v == null ? "not set" : `₹${Math.round(Number(v)).toLocaleString("en-IN")}`);
  const said: string[] = [];
  if (rest.title !== undefined && rest.title !== before?.title) said.push(`name to ${rest.title}`);
  if (rest.firmName !== undefined && rest.firmName !== before?.firmName) said.push(`firm to ${rest.firmName || "none"}`);
  if (rest.projectCost !== undefined && Number(rest.projectCost ?? -1) !== Number(before?.projectCost ?? -1))
    said.push(`cost ${inr(before?.projectCost)} → ${inr(rest.projectCost)}`);
  if (rest.status !== undefined && rest.status !== before?.status) said.push(`status to ${rest.status.toLowerCase()}`);
  if (startDate !== undefined || endDate !== undefined) said.push("dates");
  if ("number" in numberData && before && numberData.number !== before.number) said.push(`project number to ${numberOf(project)}`);
  if (said.length > 0) {
    await recordAudit(prisma, { projectId: id, actorId: uid(req), action: "project.updated", entityType: "project", entityId: id, summary: `Changed ${said.join(", ")}` }).catch(() => { });
  }
  res.json({ project: projectDto(project) });
}

export async function remove(req: Request<{ id: string }>, res: Response) {
  await requirePermission(uid(req), req.params.id, "project.delete");
  await prisma.project.delete({ where: { id: req.params.id } }); // work items and everything attached go with it (cascade)
  res.status(204).end();
}

/**
 * Quick live edit of one work item's progress and/or amount paid.
 * Updating progress needs "tasks.progress"; the amount paid is money, so that needs "project.manage".
 */
export async function patchTask(req: Request<{ id: string; taskId: string }, unknown, PatchTaskBody>, res: Response) {
  const userId = uid(req);
  const { id, taskId } = req.params;
  await requirePermission(userId, id, req.body.paid !== undefined ? "project.manage" : "tasks.progress");

  const found = await prisma.task.findFirst({ where: { id: taskId, projectId: id }, select: { id: true } });
  if (!found) throw new HttpError(404, "Task not found");

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: taskId }, data: req.body });
    await tx.project.update({ where: { id }, data: { updatedAt: new Date() } }); // keep "recently updated" sorting right
    return updated;
  });
  res.json({ task: taskDto(task) });
}