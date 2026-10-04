import { prisma } from "../../lib/prisma.js";
import { attendanceDto, toDate } from "./attendance.mapper.js";
import { listQuerySchema } from "./atttendance.schema.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../lib/error.js";
const include = {
    project: { select: { id: true, title: true } },
    workers: { orderBy: { position: "asc" } },
};
// Every query is scoped to the signed-in user (prevents one user reading another's records)
const uid = (req) => req.user.sub;
/** The client's total is never trusted: it is recomputed from the amounts (exact decimal maths) */
const computeTotal = (workers, extras) => workers.reduce((sum, w) => sum.plus(w.amount), new Prisma.Decimal(extras));
const workerRows = (workers) => workers.map((w, position) => ({ label: w.label, amount: w.amount, position }));
/** Newest first, with search and server-side pagination. Without projectId it returns recent records across all projects. */
export async function list(req, res) {
    const { projectId, q, page, pageSize } = listQuerySchema.parse(req.query);
    const where = {
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
export async function create(req, res) {
    const { projectId, contractorName, date, workers, extras, notes } = req.body;
    const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: uid(req) },
        select: { id: true },
    });
    if (!project)
        throw new HttpError(404, "Project not found");
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
export async function update(req, res) {
    const { id } = req.params;
    const { contractorName, date, workers, extras, notes } = req.body;
    const found = await prisma.attendance.findFirst({ where: { id, ownerId: uid(req) }, select: { id: true } });
    if (!found)
        throw new HttpError(404, "Record not found");
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
export async function remove(req, res) {
    const result = await prisma.attendance.deleteMany({ where: { id: req.params.id, ownerId: uid(req) } });
    if (result.count === 0)
        throw new HttpError(404, "Record not found");
    res.status(204).end(); // workers are removed by the database (onDelete: Cascade)
}
//# sourceMappingURL=attendance.controller.js.map