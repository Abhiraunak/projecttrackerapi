/**
 * The stock rules, with no database in them: give it the log, what the BOQ items need and the orders,
 * get the figures back. Stock levels are never stored: they are always worked out from the movement log.
 */

export type MovementType = "RECEIVED" | "ISSUED" | "RESERVED" | "RELEASED" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";

export interface StockEntry {
  materialId: string;
  type: MovementType;
  quantity: number;
  itemId: string | null; // the BOQ item it was issued or reserved for
}

/** How much of one material one BOQ item needs (from its recipe, wastage included) */
export interface ItemNeed {
  itemId: string;
  materialId: string;
  required: number;
}

export interface OrderFigures {
  materialId: string;
  quantity: number;
  receivedQty: number;
}

export interface MaterialInfo {
  id: string;
  name: string;
  unit: string;
  category: string;
  minStock: number;
}

export interface ItemLabel {
  id: string;
  code: string;
  title: string;
  active: boolean;
}

export interface ItemUse {
  item: ItemLabel;
  required: number;
  issued: number;
  reserved: number;
  remaining: number; // still to be issued to this item
}

export interface InventoryItem {
  material: MaterialInfo;
  required: number; // what all BOQ items need in total
  issued: number; // used on site so far
  stillNeeded: number; // required, minus what each item already used
  onHand: number; // in the store now
  reserved: number;
  available: number; // on hand and not set aside
  ordered: number; // on all orders
  incoming: number; // ordered but not yet received
  toOrder: number; // still needed beyond the store and what is on its way
  byItem: ItemUse[];
}

export interface MovementCheck {
  type: MovementType;
  quantity: number;
  itemId: string | null;
  note: string;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const formatQty = (value: number, unit: string) => `${value.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit}`;

/** Which movement types must name a BOQ item, and which must carry a note */
export const NEEDS_ITEM: Record<MovementType, boolean> = {
  RECEIVED: false,
  ISSUED: true,
  RESERVED: true,
  RELEASED: true,
  ADJUSTMENT_IN: false,
  ADJUSTMENT_OUT: false,
};
export const requiresNote = (type: MovementType) => type === "ADJUSTMENT_IN" || type === "ADJUSTMENT_OUT";

/* ------------------------------ replaying the log ------------------------- */

interface Levels {
  onHand: number;
  issued: number;
  issuedByItem: Map<string, number>;
  reservedByItem: Map<string, number>;
}

const add = (map: Map<string, number>, key: string, by: number) => {
  const next = (map.get(key) ?? 0) + by;
  if (next > 1e-9) map.set(key, next);
  else map.delete(key);
};

function applyEntry(levels: Levels, { type, quantity, itemId }: StockEntry) {
  switch (type) {
    case "RECEIVED":
    case "ADJUSTMENT_IN":
      levels.onHand += quantity;
      break;
    case "ADJUSTMENT_OUT":
      levels.onHand -= quantity;
      break;
    case "ISSUED":
      levels.onHand -= quantity;
      levels.issued += quantity;
      if (itemId) {
        add(levels.issuedByItem, itemId, quantity);
        // Material issued to the item it was reserved for uses up that reservation
        add(levels.reservedByItem, itemId, -Math.min(quantity, levels.reservedByItem.get(itemId) ?? 0));
      }
      break;
    case "RESERVED":
      if (itemId) add(levels.reservedByItem, itemId, quantity);
      break;
    case "RELEASED":
      if (itemId) add(levels.reservedByItem, itemId, -Math.min(quantity, levels.reservedByItem.get(itemId) ?? 0));
      break;
  }
}

function levelsOf(entries: StockEntry[]): Levels {
  const levels: Levels = { onHand: 0, issued: 0, issuedByItem: new Map(), reservedByItem: new Map() };
  for (const entry of entries) applyEntry(levels, entry);
  return levels;
}

/* ------------------------------ the figures ------------------------------- */

/** Figures for one material. `entries` oldest first; everything passed in is this material's only. */
export function inventoryItemFor(
  material: MaterialInfo,
  entries: StockEntry[],
  needs: ItemNeed[],
  orders: OrderFigures[],
  items: Map<string, ItemLabel>
): InventoryItem {
  const levels = levelsOf(entries);
  const requiredBy = new Map<string, number>();
  for (const need of needs) requiredBy.set(need.itemId, (requiredBy.get(need.itemId) ?? 0) + need.required);

  // Every item that needs this material, or has used or set aside some of it
  const itemIds = [...new Set([...requiredBy.keys(), ...levels.issuedByItem.keys(), ...levels.reservedByItem.keys()])];
  const byItem: ItemUse[] = itemIds.map((id) => {
    const required = round3(requiredBy.get(id) ?? 0);
    const issued = round3(levels.issuedByItem.get(id) ?? 0);
    return {
      item: items.get(id) ?? { id, code: "", title: "BOQ item", active: false },
      required,
      issued,
      reserved: round3(levels.reservedByItem.get(id) ?? 0),
      remaining: round3(Math.max(0, required - issued)),
    };
  });

  const required = round3(needs.reduce((s, n) => s + n.required, 0));
  const stillNeeded = round3(byItem.reduce((s, u) => s + u.remaining, 0));
  const reserved = round3(byItem.reduce((s, u) => s + u.reserved, 0));
  const ordered = round3(orders.reduce((s, o) => s + o.quantity, 0));
  const incoming = round3(orders.reduce((s, o) => s + Math.max(0, o.quantity - o.receivedQty), 0));
  const onHand = round3(levels.onHand);

  return {
    material,
    required,
    issued: round3(levels.issued),
    stillNeeded,
    onHand,
    reserved,
    available: round3(onHand - reserved),
    ordered,
    incoming,
    toOrder: round3(Math.max(0, stillNeeded - onHand - incoming)),
    byItem: byItem.sort((a, b) => b.required - a.required),
  };
}

const groupBy = <T>(list: T[], key: (x: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const group = groups.get(k);
    if (group) group.push(x);
    else groups.set(k, [x]);
  }
  return groups;
};

/** Figures for every material the plan needs, that was ordered, or has stock activity. `entries` oldest first. */
export function buildInventory(
  materials: MaterialInfo[],
  entries: StockEntry[],
  needs: ItemNeed[],
  orders: OrderFigures[],
  items: Map<string, ItemLabel>
): InventoryItem[] {
  const e = groupBy(entries, (x) => x.materialId);
  const n = groupBy(needs, (x) => x.materialId);
  const o = groupBy(orders, (x) => x.materialId);
  return materials
    .filter((m) => e.has(m.id) || n.has(m.id) || o.has(m.id))
    .map((m) => inventoryItemFor(m, e.get(m.id) ?? [], n.get(m.id) ?? [], o.get(m.id) ?? [], items));
}

/* -------------------------------- validation ------------------------------ */

/** The rules a stock entry must follow: a message if it breaks one, otherwise null. Stock can never go below zero. */
export function validateMovement(item: InventoryItem, input: MovementCheck): string | null {
  const unit = item.material.unit;
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return "Enter a quantity greater than zero.";
  if (NEEDS_ITEM[input.type] && !input.itemId) return "Choose the BOQ item.";
  if (requiresNote(input.type) && input.note.trim().length < 3) return "Add a short note explaining the correction.";

  switch (input.type) {
    case "ISSUED":
    case "ADJUSTMENT_OUT":
      return input.quantity > item.onHand + 1e-9 ? `Only ${formatQty(item.onHand, unit)} is in the store.` : null;
    case "RESERVED":
      return input.quantity > item.available + 1e-9 ? `Only ${formatQty(item.available, unit)} is available to reserve.` : null;
    case "RELEASED": {
      const reserved = item.byItem.find((u) => u.item.id === input.itemId)?.reserved ?? 0;
      return input.quantity > reserved + 1e-9 ? `Only ${formatQty(reserved, unit)} is reserved for that BOQ item.` : null;
    }
    default:
      return null;
  }
}
