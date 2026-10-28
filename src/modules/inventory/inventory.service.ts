import type { Material, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { MOVEMENT_PERMISSION } from "../../lib/permissions.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { refreshAlertsSoon } from "../alerts/alerts.service.js";
import { requiredQty } from "../materialPlan/plan.js";
import { movementDto, movementInclude, toEntry, toItemLabel, toMaterialInfo } from "./inventory.mapper.js";
import { NEEDS_ITEM, buildInventory, inventoryItemFor, validateMovement, type ItemNeed, type MovementType, type OrderFigures } from "./stock.js";
import type { MovementBody, MovementsQuery } from "./inventory.schema.js";

type Db = Prisma.TransactionClient | typeof prisma;

const OLDEST_FIRST = [{ createdAt: "asc" }, { id: "asc" }] as const;
const ENTRY_COLUMNS = { materialId: true, type: true, quantity: true, boqItemId: true } as const;

const VERB: Record<MovementType, string> = {
  RECEIVED: "Received",
  ISSUED: "Issued",
  RESERVED: "Reserved",
  RELEASED: "Released the reservation of",
  ADJUSTMENT_IN: "Corrected up by",
  ADJUSTMENT_OUT: "Corrected down by",
};

/** Everything the stock figures need for a project (optionally one material only) */
export async function stockInputs(db: Db, projectId: string, materialId?: string) {
  const forMaterial = materialId ? { materialId } : {};
  const [entries, itemRows, lines, orders] = await Promise.all([
    db.stockMovement.findMany({ where: { projectId, ...forMaterial }, select: ENTRY_COLUMNS, orderBy: [...OLDEST_FIRST] }),
    db.boqItem.findMany({ where: { projectId }, select: { id: true, code: true, title: true, active: true, quantity: true } }),
    db.boqItemMaterial.findMany({ where: { item: { projectId, active: true }, ...forMaterial }, select: { itemId: true, materialId: true, perUnit: true, wastagePercent: true } }),
    db.materialOrder.findMany({ where: { projectId, ...forMaterial }, select: { materialId: true, quantity: true, receivedQty: true } }),
  ]);

  const quantityOf = new Map(itemRows.map((i) => [i.id, i.quantity.toNumber()]));
  const needs: ItemNeed[] = lines.map((l) => ({
    itemId: l.itemId,
    materialId: l.materialId,
    required: requiredQty(quantityOf.get(l.itemId) ?? 0, { perUnit: l.perUnit.toNumber(), wastagePercent: l.wastagePercent.toNumber() }),
  }));
  const orderFigures: OrderFigures[] = orders.map((o) => ({ materialId: o.materialId, quantity: o.quantity.toNumber(), receivedQty: o.receivedQty.toNumber() }));
  const items = new Map(itemRows.map((i) => [i.id, toItemLabel(i)]));
  return { entries: entries.map(toEntry), needs, orders: orderFigures, items };
}

/* ------------------------------- operations ------------------------------- */

/** Per material: what the BOQ needs, what is in the store, ordered, on its way, used, and still to order */
export async function getInventory(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "materials.view");
  const { entries, needs, orders, items } = await stockInputs(prisma, projectId);
  const ids = [...new Set([...entries.map((e) => e.materialId), ...needs.map((n) => n.materialId), ...orders.map((o) => o.materialId)])];
  const materials = await prisma.material.findMany({ where: { id: { in: ids } }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  return buildInventory(materials.map(toMaterialInfo), entries, needs, orders, items);
}

export async function listMovements(userId: string, projectId: string, { materialId, boqItemId, page, pageSize }: MovementsQuery) {
  await requirePermission(userId, projectId, "materials.view");
  const where: Prisma.StockMovementWhereInput = { projectId, ...(materialId ? { materialId } : {}), ...(boqItemId ? { boqItemId } : {}) };
  const [rows, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({ where, include: movementInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.stockMovement.count({ where }),
  ]);
  return { items: rows.map(movementDto), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Use is recorded against a BOQ item of this project. A removed item can only have its reservation released. */
export async function checkItem(projectId: string, type: MovementType, itemId: string) {
  const item = await prisma.boqItem.findFirst({ where: { id: itemId, projectId }, select: { id: true, active: true } });
  if (!item) throw new HttpError(404, "BOQ item not found");
  if (!item.active && type !== "RELEASED") throw new HttpError(400, "That item is no longer in the BOQ. Release its reservation instead, or choose another item.");
}

/** A delivery can be received against an order, but only an order for this project and this material */
async function checkOrder(projectId: string, materialId: string, input: MovementBody) {
  if (!input.orderId) return;
  if (input.type !== "RECEIVED") throw new HttpError(400, "Only received stock can be linked to an order.");
  const order = await prisma.materialOrder.findFirst({ where: { id: input.orderId, projectId, materialId }, select: { id: true } });
  if (!order) throw new HttpError(400, "That order doesn't match this project and material.");
}

/**
 * Adds one entry to the stock log. The right permission depends on the kind of entry. The "is there enough?"
 * check and the insert run in one transaction, behind a lock on this project and material, so two people issuing
 * the same cement at the same moment can't push the stock below zero.
 */
export async function recordMovement(userId: string, projectId: string, input: MovementBody) {
  await requirePermission(userId, projectId, MOVEMENT_PERMISSION[input.type]);
  const material = await prisma.material.findUnique({ where: { id: input.materialId } });
  if (!material) throw new HttpError(404, "Material not found");

  const itemId = NEEDS_ITEM[input.type] ? input.boqItemId : null; // other kinds don't belong to an item
  if (itemId) await checkItem(projectId, input.type, itemId);
  await checkOrder(projectId, material.id, input);

  const row = await prisma.$transaction((tx) => recordMovementIn(tx, userId, projectId, { ...input, boqItemId: itemId }, material));
  refreshAlertsSoon(projectId);
  return movementDto(row);
}

/**
 * The checked insert itself, inside a transaction the caller owns (a material request issues stock this way,
 * so the request and the stock entry are saved together or not at all). Permissions are the caller's job.
 */
export async function recordMovementIn(tx: Prisma.TransactionClient, userId: string, projectId: string, input: MovementBody, material: Material) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${projectId}:${material.id}`}))`;
  const itemId = input.boqItemId;

  const { entries, needs, orders, items } = await stockInputs(tx, projectId, material.id);
  const figures = inventoryItemFor(toMaterialInfo(material), entries, needs, orders, items);
  const problem = validateMovement(figures, { type: input.type, quantity: input.quantity, itemId, note: input.note });
  if (problem) throw new HttpError(400, problem);

  const row = await tx.stockMovement.create({
    data: { projectId, materialId: material.id, boqItemId: itemId, orderId: input.orderId, type: input.type, quantity: input.quantity, note: input.note, createdById: userId },
    include: movementInclude,
  });
  if (input.orderId) {
    await tx.materialOrder.update({ where: { id: input.orderId }, data: { receivedQty: { increment: input.quantity } } });
  }

  const label = itemId ? items.get(itemId) : undefined;
  const forItem = label ? ` for ${[label.code, label.title].filter(Boolean).join(" ")}` : "";
  const why = input.note ? `: ${input.note}` : "";
  await recordAudit(tx, {
    projectId,
    actorId: userId,
    action: `stock.${input.type.toLowerCase()}`,
    entityType: "stock",
    entityId: row.id,
    summary: `${VERB[input.type]} ${input.quantity} ${material.unit} of ${material.name}${forItem}${why}`,
    changes: { quantity: { from: null, to: input.quantity } },
  });
  return row;
}
