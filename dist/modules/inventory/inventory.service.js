import { prisma } from "../../lib/prisma.js";
import { assertProjectOwner } from "../../lib/projectAccess.js";
import { movementDto, movementInclude, toEntry, toFigures, toMaterialInfo } from "./inventory.mapper.js";
import { NEEDS_TASK, buildInventory, inventoryItemFor, validateMovement } from "./stock.js";
import { HttpError } from "../../lib/error.js";
/* ------------------------------ small helpers ----------------------------- */
const OLDEST_FIRST = [{ createdAt: "asc" }, { id: "asc" }];
const ENTRY_COLUMNS = { materialId: true, type: true, quantity: true, taskId: true };
/** task id -> task name, for the project (a work item is called "work" in the database) */
async function taskNames(db, projectId) {
    const tasks = await db.task.findMany({ where: { projectId }, select: { id: true, work: true } });
    return new Map(tasks.map((t) => [t.id, t.work]));
}
async function assertTaskInProject(projectId, taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, projectId }, select: { id: true } });
    if (!task)
        throw new HttpError(404, "Work item not found");
}
/** Stock received can be linked to an order, but only an order for this project and this material */
async function assertReceivableOrder(projectId, materialId, input) {
    if (!input.requirementId)
        return;
    if (input.type !== "RECEIVED")
        throw new HttpError(400, "Only received stock can be linked to an order.");
    const order = await prisma.requirement.findFirst({
        where: { id: input.requirementId, projectId, materialId },
        select: { id: true },
    });
    if (!order)
        throw new HttpError(400, "That order doesn't match this project and material.");
}
/* ------------------------------- operations ------------------------------- */
export async function getInventory(ownerId, projectId) {
    await assertProjectOwner(ownerId, projectId);
    const [entries, requirements, names] = await Promise.all([
        prisma.stockMovement.findMany({ where: { projectId }, select: ENTRY_COLUMNS, orderBy: [...OLDEST_FIRST] }),
        prisma.requirement.findMany({ where: { projectId } }),
        taskNames(prisma, projectId),
    ]);
    const materialIds = [...new Set([...entries.map((e) => e.materialId), ...requirements.map((r) => r.materialId)])];
    const materials = await prisma.material.findMany({ where: { id: { in: materialIds }, ownerId }, orderBy: { name: "asc" } });
    return buildInventory(materials.map(toMaterialInfo), entries.map(toEntry), requirements.map(toFigures), names);
}
export async function listMovements(ownerId, projectId, { materialId, page, pageSize }) {
    await assertProjectOwner(ownerId, projectId);
    const where = { projectId, ...(materialId ? { materialId } : {}) };
    const [rows, total] = await prisma.$transaction([
        prisma.stockMovement.findMany({
            where,
            include: movementInclude,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }], // id breaks ties so pages never repeat or skip a row
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.stockMovement.count({ where }),
    ]);
    return {
        items: rows.map(movementDto),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
}
/**
 * Adds one entry to the stock log.
 *
 * The check "is there enough stock?" and the insert happen in one transaction, behind a lock on this
 * project and material. So two people issuing the same cement at the same moment can't both succeed
 * and push the stock below zero: the second one waits, then sees the reduced stock and is refused.
 */
export async function recordMovement(ownerId, projectId, input) {
    // Cheap checks first, outside the lock
    await assertProjectOwner(ownerId, projectId);
    const material = await prisma.material.findFirst({ where: { id: input.materialId, ownerId } });
    if (!material)
        throw new HttpError(404, "Material not found");
    const taskId = NEEDS_TASK[input.type] ? input.taskId : null; // other types don't belong to a work item
    if (taskId)
        await assertTaskInProject(projectId, taskId);
    await assertReceivableOrder(projectId, material.id, input);
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`${projectId}:${material.id}`}))`;
        const [entries, requirements, names] = await Promise.all([
            tx.stockMovement.findMany({ where: { projectId, materialId: material.id }, select: ENTRY_COLUMNS, orderBy: [...OLDEST_FIRST] }),
            tx.requirement.findMany({ where: { projectId, materialId: material.id } }),
            taskNames(tx, projectId),
        ]);
        const item = inventoryItemFor(toMaterialInfo(material), entries.map(toEntry), requirements.map(toFigures), names);
        const problem = validateMovement(item, { type: input.type, quantity: input.quantity, taskId, note: input.note });
        if (problem)
            throw new HttpError(400, problem);
        const row = await tx.stockMovement.create({
            data: {
                projectId,
                materialId: material.id,
                taskId,
                requirementId: input.requirementId,
                type: input.type,
                quantity: input.quantity,
                note: input.note,
                createdById: ownerId,
            },
            include: movementInclude,
        });
        // Stock received against an order counts as delivered on that order
        if (input.requirementId) {
            await tx.requirement.update({ where: { id: input.requirementId }, data: { receivedQty: { increment: input.quantity } } });
        }
        return movementDto(row);
    });
}
//# sourceMappingURL=inventory.service.js.map