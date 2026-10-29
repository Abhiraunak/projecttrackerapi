import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { diffFields, hasChanges } from "../audit/audit.diff.js";
import { recordAudit } from "../audit/audit.service.js";
import { materialTotalsByProject } from "../inventory/cost.service.js";
import { projectDto, summaryDto, taskDto, taskData } from "./projects.mapper.js";
import {
  statusEnum,
  type CreateBody,
  type UpdateBody,
  type PatchProjectBody,
  type PatchTaskBody,
} from "./projects.schema.js";

const withTasks = { tasks: { orderBy: { position: "asc" } } } as const;
const uid = (req: Request<any, any, any, any>) => req.user!.sub;

/** The fields of a work item that are worth recording when they change */
const TASK_FIELDS = ["work", "area", "contractorRate", "inHouseRate", "stipulated", "paid", "progress", "startDate", "endDate"] as const;

/** The project-level facts worth recording when they change */
const headline = (p: { title: string; status: string; projectCost: { toNumber(): number } | number | null }) => ({
  title: p.title,
  status: p.status,
  projectCost: p.projectCost === null ? null : typeof p.projectCost === "number" ? p.projectCost : p.projectCost.toNumber(),
});

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
  const materials = await materialTotalsByProject(projects.map((p) => p.id));
  res.json({ projects: projects.map((p) => summaryDto(p, materials.get(p.id))) });
}

export async function create(req: Request<unknown, unknown, CreateBody>, res: Response) {
  const userId = uid(req);
  await requireCan(userId, "project.manage");
  const { title, projectCost, tasks } = req.body;

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { title, projectCost, ownerId: userId, tasks: { create: tasks.map((t, i) => taskData(t, i)) } },
      include: withTasks,
    });
    await recordAudit(tx, {
      projectId: created.id,
      actorId: userId,
      action: "project.created",
      entityType: "project",
      entityId: created.id,
      summary: `Created project "${title}" with ${tasks.length} work ${tasks.length === 1 ? "item" : "items"}`,
    });
    return created;
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
    const current = await tx.project.findUniqueOrThrow({ where: { id }, select: { title: true, status: true, projectCost: true } });
    const existingRows = await tx.task.findMany({ where: { projectId: id } });
    const existing = new Map(existingRows.map((t) => [t.id, t]));

    const keep = tasks.filter((t) => t.id && existing.has(t.id)).map((t) => t.id!);
    const removed = existingRows.filter((t) => !keep.includes(t.id));
    await tx.task.deleteMany({ where: { projectId: id, id: { notIn: keep } } });
    for (const row of removed) {
      await recordAudit(tx, { projectId: id, actorId: userId, action: "task.deleted", entityType: "task", entityId: row.id, summary: `Removed work item "${row.work}"` });
    }

    for (const [i, t] of tasks.entries()) {
      const before = t.id ? existing.get(t.id) : undefined;
      if (before) {
        await tx.task.update({ where: { id: before.id }, data: taskData(t, i) });
        // Record who changed a quantity, rate, budget or date, and from what to what
        const changes = diffFields(taskDto(before), t, TASK_FIELDS);
        if (hasChanges(changes)) {
          await recordAudit(tx, { projectId: id, actorId: userId, action: "task.updated", entityType: "task", entityId: before.id, summary: `Edited work item "${t.work}"`, changes });
        }
      } else {
        const created = await tx.task.create({ data: { ...taskData(t, i), projectId: id } });
        await recordAudit(tx, { projectId: id, actorId: userId, action: "task.created", entityType: "task", entityId: created.id, summary: `Added work item "${t.work}"` });
      }
    }

    const changes = diffFields(headline(current), headline({ title, status: status ?? current.status, projectCost }), ["title", "status", "projectCost"]);
    if (hasChanges(changes)) {
      await recordAudit(tx, { projectId: id, actorId: userId, action: "project.updated", entityType: "project", entityId: id, summary: "Changed project details", changes });
    }

    return tx.project.update({ where: { id }, data: { title, projectCost, ...(status ? { status } : {}) }, include: withTasks });
  });

  res.json({ project: projectDto(project) });
}

export async function patchProject(req: Request<{ id: string }, unknown, PatchProjectBody>, res: Response) {
  const userId = uid(req);
  const { id } = req.params;
  await requirePermission(userId, id, "project.manage");

  const project = await prisma.$transaction(async (tx) => {
    const before = await tx.project.findUniqueOrThrow({ where: { id }, select: { title: true, status: true, projectCost: true } });
    const updated = await tx.project.update({ where: { id }, data: req.body, include: withTasks });
    const changes = diffFields(headline(before), headline(updated), ["title", "status", "projectCost"]);
    if (hasChanges(changes)) {
      await recordAudit(tx, { projectId: id, actorId: userId, action: "project.updated", entityType: "project", entityId: id, summary: "Changed project details", changes });
    }
    return updated;
  });
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

  const before = await prisma.task.findFirst({ where: { id: taskId, projectId: id } });
  if (!before) throw new HttpError(404, "Task not found");

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: taskId }, data: req.body });
    await tx.project.update({ where: { id }, data: { updatedAt: new Date() } }); // keep "recently updated" sorting right

    const changes = diffFields(taskDto(before), taskDto(updated), ["progress", "paid"]);
    if (hasChanges(changes)) {
      await recordAudit(tx, { projectId: id, actorId: userId, action: "task.progress_updated", entityType: "task", entityId: taskId, summary: `Updated "${updated.work}"`, changes });
    }
    return updated;
  });
  res.json({ task: taskDto(task) });
}
