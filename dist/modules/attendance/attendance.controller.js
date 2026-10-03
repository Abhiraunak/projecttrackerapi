import { prisma } from "../../lib/prisma.js";
import { attendanceDto, toDate } from "./attendance.mapper.js";
// 1. Import the actual Zod schemas instead of just the types
import { listQuerySchema, createBodySchema, updateBodySchema } from "./atttendance.schema.js";
import { HttpError } from "../../lib/error.js";
import { Prisma } from "../../generated/prisma/client.js";
const include = {
    project: { select: { id: true, title: true } },
    workers: { orderBy: { position: "asc" } },
};
const uid = (req) => req.user.sub;
const computeTotal = (workers, extras) => workers.reduce((sum, w) => sum.plus(w.amount), new Prisma.Decimal(extras));
const workerRows = (workers) => workers.map((w, position) => ({ label: w.label, amount: w.amount, position }));
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
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
// 2. Remove the heavy Request generics; Zod will type the destructured variables automatically.
export async function create(req, res) {
    // 3. Parse and validate the body at runtime. If it fails, Zod throws an error (caught by your error handler).
    const { projectId, contractorName, date, workers, extras, notes } = createBodySchema.parse(req.body);
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
    // 4. Validate the update payload identically.
    const { contractorName, date, workers, extras, notes } = updateBodySchema.parse(req.body);
    const found = await prisma.attendance.findFirst({ where: { id, ownerId: uid(req) }, select: { id: true } });
    if (!found)
        throw new HttpError(404, "Record not found");
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
    res.status(204).end();
}
//# sourceMappingURL=attendance.controller.js.map