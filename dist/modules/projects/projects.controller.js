import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { toDate } from "../../lib/dates.js";
import { getUserAccess, requireCan, requirePermission } from "../../lib/projectAccess.js";
import { projectDto, summaryDto, taskDto, taskData } from "./projects.mapper.js";
import { spendByProject } from "./spend.service.js";
import { statusEnum, } from "./projects.schema.js";
const withTasks = { tasks: { orderBy: { position: "asc" } } };
const uid = (req) => req.user.sub;
/** Every project: access is company-wide, so anyone allowed to view projects sees all of them */
export async function list(req, res) {
    await requireCan(uid(req), "project.view");
    const status = statusEnum.safeParse(req.query.status);
    const projects = await prisma.project.findMany({
        where: { status: status.success ? status.data : { not: "ARCHIVED" } },
        include: { ...withTasks, _count: { select: { attendance: true } } },
        orderBy: { updatedAt: "desc" },
        take: 100,
    });
    const ids = projects.map((p) => p.id);
    // Total spend for each tile: the same sum as the project's Overview
    const spend = await spendByProject(ids);
    res.json({ projects: projects.map((p) => summaryDto(p, spend.get(p.id))) });
}
export async function create(req, res) {
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
export async function getOne(req, res) {
    await requirePermission(uid(req), req.params.id, "project.view");
    const project = await prisma.project.findUniqueOrThrow({ where: { id: req.params.id }, include: withTasks });
    res.json({ project: projectDto(project) });
}
/** Full edit from the form: update existing work items, add new ones, delete removed ones, all or nothing. */
export async function update(req, res) {
    const userId = uid(req);
    const { id } = req.params;
    const { title, projectCost, status, tasks } = req.body;
    await requirePermission(userId, id, "project.manage");
    const project = await prisma.$transaction(async (tx) => {
        const existingRows = await tx.task.findMany({ where: { projectId: id }, select: { id: true } });
        const existing = new Set(existingRows.map((t) => t.id));
        // Work items left out of the form are deleted; the rest are updated, and new ones added
        const keep = tasks.filter((t) => t.id && existing.has(t.id)).map((t) => t.id);
        await tx.task.deleteMany({ where: { projectId: id, id: { notIn: keep } } });
        for (const [i, t] of tasks.entries()) {
            if (t.id && existing.has(t.id))
                await tx.task.update({ where: { id: t.id }, data: taskData(t, i) });
            else
                await tx.task.create({ data: { ...taskData(t, i), projectId: id } });
        }
        return tx.project.update({ where: { id }, data: { title, projectCost, ...(status ? { status } : {}) }, include: withTasks });
    });
    res.json({ project: projectDto(project) });
}
export async function patchProject(req, res) {
    const { id } = req.params;
    await requirePermission(uid(req), id, "project.manage");
    // The dates come as "2026-11-05"; the database needs real dates (null clears them, left out keeps them)
    const { startDate, endDate, ...rest } = req.body;
    const data = {
        ...rest,
        ...(startDate !== undefined && { startDate: startDate ? toDate(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? toDate(endDate) : null }),
    };
    const project = await prisma.project.update({ where: { id }, data, include: withTasks });
    res.json({ project: projectDto(project) });
}
export async function remove(req, res) {
    await requirePermission(uid(req), req.params.id, "project.delete");
    await prisma.project.delete({ where: { id: req.params.id } }); // work items and everything attached go with it (cascade)
    res.status(204).end();
}
/**
 * Quick live edit of one work item's progress and/or amount paid.
 * Updating progress needs "tasks.progress"; the amount paid is money, so that needs "project.manage".
 */
export async function patchTask(req, res) {
    const userId = uid(req);
    const { id, taskId } = req.params;
    await requirePermission(userId, id, req.body.paid !== undefined ? "project.manage" : "tasks.progress");
    const found = await prisma.task.findFirst({ where: { id: taskId, projectId: id }, select: { id: true } });
    if (!found)
        throw new HttpError(404, "Task not found");
    const task = await prisma.$transaction(async (tx) => {
        const updated = await tx.task.update({ where: { id: taskId }, data: req.body });
        await tx.project.update({ where: { id }, data: { updatedAt: new Date() } }); // keep "recently updated" sorting right
        return updated;
    });
    res.json({ task: taskDto(task) });
}
//# sourceMappingURL=projects.controller.js.map