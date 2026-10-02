import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { projectDto, summaryDto, taskData, taskDto } from "./projects.mapper.js";
import { CreateBody, PatchProjectBody, PatchTaskBody, UpdateBody, statusEnum } from "./projects.schema.js";


const withTasks = { tasks: { orderBy: { position: "asc" } } } as const;

// Every query is scoped to the signed-in user, so one user can never read or change another's project (IDOR)
const uid = (req: Request) => req.user!.sub;

export async function list(req: Request, res: Response) {
  const status = statusEnum.safeParse(req.query.status);
  const projects = await prisma.project.findMany({
    where: { ownerId: uid(req), status: status.success ? status.data : { not: "ARCHIVED" } },
    include: withTasks,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  res.json({ projects: projects.map(summaryDto) });
}

export async function create(req: Request<unknown, unknown, CreateBody>, res: Response) {
  const { title, tasks } = req.body;
  const project = await prisma.project.create({
    data: { title, ownerId: uid(req), tasks: { create: tasks.map((t, i) => taskData(t, i)) } },
    include: withTasks,
  });
  res.status(201).json({ project: projectDto(project) });
}

export async function getOne(req: Request<{ id: string }>, res: Response) {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, ownerId: uid(req) },
    include: withTasks,
  });
  if (!project) throw new HttpError(404, "Project not found");
  res.json({ project: projectDto(project) });
}

/** Full edit from the form: update existing tasks, add new ones, delete removed ones, all or nothing. */
export async function update(req: Request<{ id: string }, unknown, UpdateBody>, res: Response) {
  const { id } = req.params;
  const { title, status, tasks } = req.body;

  const project = await prisma.$transaction(async (tx) => {
    const found = await tx.project.findFirst({
      where: { id, ownerId: uid(req) },
      select: { tasks: { select: { id: true } } },
    });
    if (!found) throw new HttpError(404, "Project not found");

    const existing = new Set(found.tasks.map((t) => t.id));
    const keep = tasks.filter((t) => t.id && existing.has(t.id)).map((t) => t.id!);
    await tx.task.deleteMany({ where: { projectId: id, id: { notIn: keep } } });

    for (const [i, t] of tasks.entries()) {
      if (t.id && existing.has(t.id)) {
        await tx.task.update({ where: { id: t.id }, data: taskData(t, i) });
      } else {
        await tx.task.create({ data: { ...taskData(t, i), projectId: id } });
      }
    }

    return tx.project.update({
      where: { id },
      data: { title, ...(status ? { status } : {}) },
      include: withTasks,
    });
  });

  res.json({ project: projectDto(project) });
}

export async function patchProject(req: Request<{ id: string }, unknown, PatchProjectBody>, res: Response) {
  const { id } = req.params;
  const result = await prisma.project.updateMany({ where: { id, ownerId: uid(req) }, data: req.body });
  if (result.count === 0) throw new HttpError(404, "Project not found");
  const project = await prisma.project.findUniqueOrThrow({ where: { id }, include: withTasks });
  res.json({ project: projectDto(project) });
}

export async function remove(req: Request<{ id: string }>, res: Response) {
  const result = await prisma.project.deleteMany({ where: { id: req.params.id, ownerId: uid(req) } });
  if (result.count === 0) throw new HttpError(404, "Project not found");
  res.status(204).end(); // tasks are removed by the database (onDelete: Cascade)
}

/** Quick live edit of one task's progress and/or amount paid */
export async function patchTask(
  req: Request<{ id: string; taskId: string }, unknown, PatchTaskBody>,
  res: Response
) {
  const { id, taskId } = req.params;
  const result = await prisma.task.updateMany({
    where: { id: taskId, projectId: id, project: { ownerId: uid(req) } },
    data: req.body,
  });
  if (result.count === 0) throw new HttpError(404, "Task not found");

  await prisma.project.update({ where: { id }, data: { updatedAt: new Date() } }); // keep "recently updated" sorting right
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  res.json({ task: taskDto(task) });
}