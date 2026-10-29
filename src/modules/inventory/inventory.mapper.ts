import { Material, Prisma, StockMovement } from "../../generated/prisma/client.js";
import type { ItemLabel, MaterialInfo, StockEntry } from "./stock.js";

/** What to load with a movement: the material, the BOQ item, the order and who recorded it */
export const movementInclude = {
  material: { select: { id: true, name: true, unit: true } },
  boqItem: { select: { id: true, code: true, title: true } },
  order: { select: { id: true, reference: true } },
  createdBy: { select: { email: true } },
} as const;

export type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

export const movementDto = (row: MovementRow) => ({
  id: row.id,
  material: row.material,
  type: row.type,
  quantity: row.quantity.toNumber(),
  boqItem: row.boqItem,
  order: row.order,
  note: row.note,
  createdAt: row.createdAt,
  createdBy: row.createdBy.email,
});

export const toMaterialInfo = (m: Material): MaterialInfo => ({
  id: m.id,
  name: m.name,
  unit: m.unit,
  category: m.category,
  minStock: m.minStock.toNumber(),
});

export const toEntry = (row: Pick<StockMovement, "materialId" | "type" | "quantity" | "boqItemId">): StockEntry => ({
  materialId: row.materialId,
  type: row.type,
  quantity: row.quantity.toNumber(),
  itemId: row.boqItemId,
});

export const toItemLabel = (i: { id: string; code: string; title: string; active: boolean }): ItemLabel => ({ id: i.id, code: i.code, title: i.title, active: i.active });
