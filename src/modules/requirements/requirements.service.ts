import { prisma } from "../../lib/prisma.js";

import { toDate } from "../../lib/dates.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { assertProjectOwner } from "../../lib/projectAccess.js";
import { requirementDto, requirementInclude } from "./requirements.mapper.js";
import type { CreateRequirementBody, OrderBody } from "./requirements.schema.js";
import { HttpError } from "../../lib/error.js";

/* ------------------------------ small helpers ----------------------------- */

/** A requirement that belongs to one of this user's projects, or a 404 */
async function loadOwned(ownerId: string, requirementId: string) {
  const row = await prisma.requirement.findFirst({
    where: { id: requirementId, project: { ownerId } },
    include: requirementInclude,
  });
  if (!row) throw new HttpError(404, "Requirement not found");
  return row;
}

async function assertVendorOwned(ownerId: string, vendorId: string) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, ownerId }, select: { id: true } });
  if (!vendor) throw new HttpError(404, "Vendor not found");
}

/* ------------------------------- operations ------------------------------- */

export async function listRequirements(ownerId: string, projectId: string) {
  await assertProjectOwner(ownerId, projectId);
  const rows = await prisma.requirement.findMany({
    where: { projectId },
    include: requirementInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(requirementDto);
}

export async function createRequirement(ownerId: string, projectId: string, input: CreateRequirementBody) {
  await assertProjectOwner(ownerId, projectId);

  const [task, material] = await Promise.all([
    prisma.task.findFirst({ where: { id: input.taskId, projectId }, select: { id: true } }),
    prisma.material.findFirst({ where: { id: input.materialId, ownerId }, select: { id: true } }),
  ]);
  if (!task) throw new HttpError(404, "Work item not found");
  if (!material) throw new HttpError(404, "Material not found");

  try {
    const row = await prisma.requirement.create({
      data: {
        projectId,
        taskId: input.taskId,
        materialId: input.materialId,
        requiredQty: input.requiredQty,
        wastagePercent: input.wastagePercent,
      },
      include: requirementInclude,
    });
    return requirementDto(row);
  } catch (error) {
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
export async function updateOrder(ownerId: string, requirementId: string, update: OrderBody) {
  const current = await loadOwned(ownerId, requirementId);

  const received = current.receivedQty.toNumber();
  if (update.orderedQty < received) {
    throw new HttpError(400, `${received} ${current.material.unit} is already received, so the order can't be smaller.`);
  }
  if (update.orderedQty > 0 && (!update.vendorId || !update.expectedDelivery)) {
    throw new HttpError(400, "An order needs a vendor and an expected delivery date.");
  }
  if (update.vendorId) await assertVendorOwned(ownerId, update.vendorId);

  // The condition on receivedQty makes the check hold even if a delivery is recorded at this very moment
  const result = await prisma.requirement.updateMany({
    where: { id: requirementId, receivedQty: { lte: update.orderedQty } },
    data: {
      vendorId: update.vendorId,
      orderedQty: update.orderedQty,
      expectedDelivery: update.expectedDelivery ? toDate(update.expectedDelivery) : null,
      requested: update.orderedQty > 0 ? false : update.requested, // once ordered, the request is done
    },
  });
  if (result.count === 0) {
    throw new HttpError(409, "Material was just received against this order. Reload and try again.");
  }

  return requirementDto(await loadOwned(ownerId, requirementId));
}

/** Only a requirement nothing has been received against can be deleted */
export async function deleteRequirement(ownerId: string, requirementId: string) {
  const current = await loadOwned(ownerId, requirementId);
  if (current.receivedQty.toNumber() > 0) {
    throw new HttpError(409, "Material for this requirement has already been received, so it can't be deleted.");
  }
  const result = await prisma.requirement.deleteMany({ where: { id: requirementId, receivedQty: 0 } });
  if (result.count === 0) throw new HttpError(409, "Material was just received against this requirement. Reload and try again.");
}
