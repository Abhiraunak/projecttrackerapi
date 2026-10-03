import type { Request, Response } from "express";

import { prisma } from "../../lib/prisma.js";
import { attendanceDto, toDate } from "./attendance.mapper.js";
import { listQuerySchema, type CreateBody, type UpdateBody } from "./atttendance.schema.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../lib/error.js";

const include = {
  project: { select: { id: true, title: true } },
  workers: { orderBy: { position: "asc" } },
} as const;

// Every query is scoped to the signed-in user (prevents one user reading another's records)
const uid = (req: Pick<Request, "user">) => req.user!.sub;

/** The client's total is never trusted: it is recomputed from the amounts (exact decimal maths) */
const computeTotal = (workers: { amount: number }[], extras: number) =>
  workers.reduce((sum, w) => sum.plus(w.amount), new Prisma.Decimal(extras));

const workerRows = (workers: { label: string; amount: number }[]) =>
  workers.map((w, position) => ({ label: w.label, amount: w.amount, position }));

/** Newest first, with search and server-side pagination. Without projectId it returns recent records across all projects. */
export async function list(req: Request, res: Response) {
  const { projectId, q, page, pageSize } = listQuerySchema.parse(req.query);

  const where: Prisma.AttendanceWhereInput = {
    ownerId: uid(req),
    ...(projectId ? { projectId } : {}),
    ...(q
      ? {
          OR: [
            { contractorName: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

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

  res.json({
    items: items.map(attendanceDto),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export async function create(req: Request<unknown, unknown, CreateBody>, res: Response) {
  const { projectId, contractorName, date, workers, extras, notes } = req.body;

  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: uid(req) },
    select: { id: true },
  });
  if (!project) throw new HttpError(404, "Project not found");

  const record = await prisma.attendance.create({
    data: {
      ownerId: uid(req),
      projectId,
      contractorName,
      date: toDate(date),
      extras,
      notes,
      totalAmount: computeTotal(workers, extras),
      workers: { create: workerRows(workers) },
    },
    include,
  });
  res.status(201).json({ attendance: attendanceDto(record) });
}

export async function update(req: Request<{ id: string }, unknown, UpdateBody>, res: Response) {
  const { id } = req.params;
  const { contractorName, date, workers, extras, notes } = req.body;

  const found = await prisma.attendance.findFirst({ where: { id, ownerId: uid(req) }, select: { id: true } });
  if (!found) throw new HttpError(404, "Record not found");

  // One statement: replace the workers and update the record together (atomic)
  const record = await prisma.attendance.update({
    where: { id },
    data: {
      contractorName,
      date: toDate(date),
      extras,
      notes,
      totalAmount: computeTotal(workers, extras),
      workers: { deleteMany: {}, create: workerRows(workers) },
    },
    include,
  });
  res.json({ attendance: attendanceDto(record) });
}

export async function remove(req: Request<{ id: string }>, res: Response) {
  const result = await prisma.attendance.deleteMany({ where: { id: req.params.id, ownerId: uid(req) } });
  if (result.count === 0) throw new HttpError(404, "Record not found");
  res.status(204).end(); // workers are removed by the database (onDelete: Cascade)
}