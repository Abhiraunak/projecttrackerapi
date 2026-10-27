import { prisma } from "../../lib/prisma.js";
import { toDay } from "../../lib/dates.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { diffFields, hasChanges } from "../audit/audit.diff.js";
import { recordAudit } from "../audit/audit.service.js";
import { attendanceDto, toDate } from "./attendance.mapper.js";
import { listQuerySchema } from "./atttendance.schema.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../lib/error.js";
const include = {
    project: { select: { id: true, title: true } },
    workers: { orderBy: { position: "asc" } },
};
const uid = (req) => req.user.sub;
/** The client's total is never trusted: it is recomputed from the amounts (exact decimal maths) */
const computeTotal = (workers, extras) => workers.reduce((sum, w) => sum.plus(w.amount), new Prisma.Decimal(extras));
const workerRows = (workers) => workers.map((w, position) => ({ label: w.label, amount: w.amount, position }));
/** Which attendance records this person may see: access is company-wide, so it is one project or all of them */
async function visibleScope(userId, projectId) {
    if (projectId) {
        await requirePermission(userId, projectId, "attendance.view");
        return { projectId };
    }
    await requireCan(userId, "attendance.view");
    return {};
}
/** Newest first, with search and server-side pagination. Without projectId it returns recent records across your projects. */
export async function list(req, res) {
    const { projectId, q, page, pageSize } = listQuerySchema.parse(req.query);
    const search = q
        ? { OR: [{ contractorName: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } }] }
        : {};
    const where = { AND: [await visibleScope(uid(req), projectId), search] };
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
    res.json({ items: items.map(attendanceDto), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}
export async function create(req, res) {
    const userId = uid(req);
    const { projectId, contractorName, date, workers, extras, notes } = req.body;
    await requirePermission(userId, projectId, "attendance.write");
    const record = await prisma.$transaction(async (tx) => {
        const created = await tx.attendance.create({
            data: {
                ownerId: userId, // who entered it
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
        const total = created.totalAmount.toNumber();
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "attendance.created",
            entityType: "attendance",
            entityId: created.id,
            summary: `Added attendance entry for ${contractorName} on ${date}: total ${total}`,
            changes: { totalAmount: { from: null, to: total } },
        });
        return created;
    });
    res.status(201).json({ attendance: attendanceDto(record) });
}
/**
 * The same labour and amounts on several days: one entry per day, so each day still has its own slip, can be
 * edited or deleted on its own, and is counted on its own date. All are saved together or none are.
 */
export async function createMany(req, res) {
    const userId = uid(req);
    const { projectId, contractorName, dates, workers, extras, notes } = req.body;
    await requirePermission(userId, projectId, "attendance.write");
    const days = [...dates].sort();
    const perDay = computeTotal(workers, extras);
    const records = await prisma.$transaction(async (tx) => {
        const created = [];
        for (const date of days) {
            created.push(await tx.attendance.create({
                data: {
                    ownerId: userId,
                    projectId,
                    contractorName,
                    date: toDate(date),
                    extras,
                    notes,
                    totalAmount: perDay,
                    workers: { create: workerRows(workers) },
                },
                include,
            }));
        }
        const total = perDay.times(days.length).toNumber();
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "attendance.created",
            entityType: "attendance",
            entityId: created[0].id,
            summary: `Added attendance for ${contractorName} on ${days.length} days (${days[0]} to ${days[days.length - 1]}): ${perDay.toNumber()} a day, total ${total}`,
            changes: { totalAmount: { from: null, to: total }, days: { from: null, to: days.join(", ") } },
        });
        return created;
    }, { timeout: 20_000 }); // up to 62 entries: give the transaction more than the default 5 seconds
    res.status(201).json({ attendance: records.map(attendanceDto), count: records.length });
}
export async function update(req, res) {
    const userId = uid(req);
    const { id } = req.params;
    const { contractorName, date, workers, extras, notes } = req.body;
    const before = await prisma.attendance.findUnique({ where: { id } });
    if (!before)
        throw new HttpError(404, "Record not found");
    await requirePermission(userId, before.projectId, "attendance.write");
    // One statement: replace the workers and update the record together (atomic)
    const record = await prisma.$transaction(async (tx) => {
        const updated = await tx.attendance.update({
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
        const facts = (r) => ({
            contractorName: r.contractorName,
            date: toDay(r.date),
            extras: r.extras.toNumber(),
            totalAmount: r.totalAmount.toNumber(),
        });
        const changes = diffFields(facts(before), facts(updated), ["contractorName", "date", "extras", "totalAmount"]);
        if (hasChanges(changes)) {
            await recordAudit(tx, {
                projectId: before.projectId,
                actorId: userId,
                action: "attendance.updated",
                entityType: "attendance",
                entityId: id,
                summary: `Edited attendance entry for ${contractorName} on ${date}`,
                changes,
            });
        }
        return updated;
    });
    res.json({ attendance: attendanceDto(record) });
}
/** Deleting a payment record needs a manager, not just someone who may enter attendance */
export async function remove(req, res) {
    const userId = uid(req);
    const { id } = req.params;
    const before = await prisma.attendance.findUnique({ where: { id } });
    if (!before)
        throw new HttpError(404, "Record not found");
    await requirePermission(userId, before.projectId, "project.manage");
    await prisma.$transaction(async (tx) => {
        await tx.attendance.delete({ where: { id } }); // workers are removed by the database (onDelete: Cascade)
        await recordAudit(tx, {
            projectId: before.projectId,
            actorId: userId,
            action: "attendance.deleted",
            entityType: "attendance",
            entityId: id,
            summary: `Deleted attendance entry for ${before.contractorName} on ${toDay(before.date)}: total ${before.totalAmount.toNumber()}`,
            changes: { totalAmount: { from: before.totalAmount.toNumber(), to: null } },
        });
    });
    res.status(204).end();
}
//# sourceMappingURL=attendance.controller.js.map