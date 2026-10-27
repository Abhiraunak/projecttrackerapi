import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { toDate, toDay } from "../../lib/dates.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { diffFields, hasChanges } from "../audit/audit.diff.js";
import { recordAudit } from "../audit/audit.service.js";
import { requirementDto, requirementInclude } from "./requirements.mapper.js";
/* ------------------------------ small helpers ----------------------------- */
/** Finds the requirement, then checks the user's role on ITS project */
async function loadAuthorized(userId, requirementId, permission) {
    const found = await prisma.requirement.findUnique({ where: { id: requirementId }, select: { projectId: true } });
    if (!found)
        throw new HttpError(404, "Requirement not found");
    const access = await requirePermission(userId, found.projectId, permission);
    const row = await prisma.requirement.findUniqueOrThrow({ where: { id: requirementId }, include: requirementInclude });
    return { row, access };
}
async function assertVendorExists(vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
    if (!vendor)
        throw new HttpError(404, "Vendor not found");
}
/** The order-related facts of a requirement, in the form the audit log compares */
const orderFacts = (r) => ({
    vendor: r.vendor?.name ?? null,
    orderedQty: r.orderedQty.toNumber(),
    expectedDelivery: r.expectedDelivery ? toDay(r.expectedDelivery) : null,
    requested: r.requested,
});
const label = (r) => `${r.material.name} for ${r.task.work}`;
/* ------------------------------- operations ------------------------------- */
export async function listRequirements(userId, projectId) {
    await requirePermission(userId, projectId, "materials.view");
    const rows = await prisma.requirement.findMany({
        where: { projectId },
        include: requirementInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(requirementDto);
}
export async function createRequirement(userId, projectId, input) {
    await requirePermission(userId, projectId, "requirements.create");
    const [task, material] = await Promise.all([
        prisma.task.findFirst({ where: { id: input.taskId, projectId }, select: { id: true } }),
        prisma.material.findUnique({ where: { id: input.materialId }, select: { id: true } }),
    ]);
    if (!task)
        throw new HttpError(404, "Work item not found");
    if (!material)
        throw new HttpError(404, "Material not found");
    try {
        return await prisma.$transaction(async (tx) => {
            const row = await tx.requirement.create({
                data: { projectId, taskId: input.taskId, materialId: input.materialId, requiredQty: input.requiredQty, wastagePercent: input.wastagePercent },
                include: requirementInclude,
            });
            await recordAudit(tx, {
                projectId,
                actorId: userId,
                action: "requirement.created",
                entityType: "requirement",
                entityId: row.id,
                summary: `Added requirement: ${label(row)}`,
                changes: { requiredQty: { from: null, to: input.requiredQty }, wastagePercent: { from: null, to: input.wastagePercent } },
            });
            return requirementDto(row);
        });
    }
    catch (error) {
        if (isUniqueViolation(error)) {
            throw new HttpError(409, "That work item already has a requirement for this material. Edit it instead.");
        }
        throw error;
    }
}
/**
 * Sets the vendor, quantity ordered and expected delivery.
 * An order can never be smaller than what has already been received.
 */
export async function updateOrder(userId, requirementId, update) {
    const { row: current } = await loadAuthorized(userId, requirementId, "requirements.order");
    const received = current.receivedQty.toNumber();
    if (update.orderedQty < received) {
        throw new HttpError(400, `${received} ${current.material.unit} is already received, so the order can't be smaller.`);
    }
    if (update.orderedQty > 0 && (!update.vendorId || !update.expectedDelivery)) {
        throw new HttpError(400, "An order needs a vendor and an expected delivery date.");
    }
    if (update.vendorId)
        await assertVendorExists(update.vendorId);
    return prisma.$transaction(async (tx) => {
        // The condition on receivedQty makes the check hold even if a delivery is recorded at this very moment
        const result = await tx.requirement.updateMany({
            where: { id: requirementId, receivedQty: { lte: update.orderedQty } },
            data: {
                vendorId: update.vendorId,
                orderedQty: update.orderedQty,
                expectedDelivery: update.expectedDelivery ? toDate(update.expectedDelivery) : null,
                requested: update.orderedQty > 0 ? false : update.requested, // once ordered, the request is done
            },
        });
        if (result.count === 0)
            throw new HttpError(409, "Material was just received against this order. Reload and try again.");
        const updated = await tx.requirement.findUniqueOrThrow({ where: { id: requirementId }, include: requirementInclude });
        const changes = diffFields(orderFacts(current), orderFacts(updated), ["vendor", "orderedQty", "expectedDelivery", "requested"]);
        if (hasChanges(changes)) {
            await recordAudit(tx, {
                projectId: current.projectId,
                actorId: userId,
                action: "requirement.order_updated",
                entityType: "requirement",
                entityId: requirementId,
                summary: `Updated order: ${label(updated)}`,
                changes,
            });
        }
        return requirementDto(updated);
    });
}
/** Only a requirement nothing has been received against can be deleted */
export async function deleteRequirement(userId, requirementId) {
    const { row: current } = await loadAuthorized(userId, requirementId, "requirements.delete");
    if (current.receivedQty.toNumber() > 0) {
        throw new HttpError(409, "Material for this requirement has already been received, so it can't be deleted.");
    }
    await prisma.$transaction(async (tx) => {
        const result = await tx.requirement.deleteMany({ where: { id: requirementId, receivedQty: 0 } });
        if (result.count === 0)
            throw new HttpError(409, "Material was just received against this requirement. Reload and try again.");
        await recordAudit(tx, {
            projectId: current.projectId,
            actorId: userId,
            action: "requirement.deleted",
            entityType: "requirement",
            entityId: requirementId,
            summary: `Deleted requirement: ${label(current)}`,
            changes: { requiredQty: { from: current.requiredQty.toNumber(), to: null } },
        });
    });
}
//# sourceMappingURL=requirements.service.js.map