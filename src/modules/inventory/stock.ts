/**
 * The stock rules, with no database in them: give it the log and the requirements, get the figures back.
 * Stock levels are never stored. They are always worked out from the movement log, so they can't drift.
 * (The frontend has a copy of validateMovement for instant feedback; this one is the authority.)
 */

export type MovementType = "RECEIVED" | "ISSUED" | "RESERVED" | "RELEASED" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";

export interface StockEntry {
  materialId: string;
  type: MovementType;
  quantity: number;
  taskId: string | null;
}

export interface RequirementFigures {
  materialId: string;
  taskId: string;
  requiredQty: number;
  wastagePercent: number;
  orderedQty: number;
  receivedQty: number;
}

export interface MaterialInfo {
  id: string;
  name: string;
  unit: string;
  category: string;
  minStock: number;
}

export interface InventoryItem {
  material: MaterialInfo;
  onHand: number;
  reserved: number;
  available: number;
  consumed: number;
  stillNeeded: number;
  incoming: number;
  shortage: number;
  reservedByTask: { task: { id: string; name: string }; quantity: number }[];
}

export interface MovementCheck {
  type: MovementType;
  quantity: number;
  taskId: string | null;
  note: string;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const formatQty = (value: number, unit: string) => `${value.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit}`;

export const totalRequired = (r: Pick<RequirementFigures, "requiredQty" | "wastagePercent">) =>
  round3(r.requiredQty * (1 + r.wastagePercent / 100));

const pendingQty = (r: RequirementFigures) => round3(Math.max(0, r.orderedQty - r.receivedQty));

/** Which movement types must name a work item, and which must carry a note */
export const NEEDS_TASK: Record<MovementType, boolean> = {
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
  consumed: number;
  consumedByTask: Map<string, number>;
  reservedByTask: Map<string, number>;
}

const emptyLevels = (): Levels => ({ onHand: 0, consumed: 0, consumedByTask: new Map(), reservedByTask: new Map() });

function shrinkReservation(levels: Levels, taskId: string, quantity: number) {
  const left = (levels.reservedByTask.get(taskId) ?? 0) - quantity;
  if (left > 0) levels.reservedByTask.set(taskId, left);
  else levels.reservedByTask.delete(taskId);
}

function applyEntry(levels: Levels, entry: StockEntry) {
  const { type, quantity, taskId } = entry;
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
      levels.consumed += quantity;
      if (taskId) {
        levels.consumedByTask.set(taskId, (levels.consumedByTask.get(taskId) ?? 0) + quantity);
        // Material used by the work item it was reserved for uses up that reservation
        shrinkReservation(levels, taskId, Math.min(quantity, levels.reservedByTask.get(taskId) ?? 0));
      }
      break;
    case "RESERVED":
      if (taskId) levels.reservedByTask.set(taskId, (levels.reservedByTask.get(taskId) ?? 0) + quantity);
      break;
    case "RELEASED":
      if (taskId) shrinkReservation(levels, taskId, Math.min(quantity, levels.reservedByTask.get(taskId) ?? 0));
      break;
  }
}

/** `entries` must be oldest first */
function levelsOf(entries: StockEntry[]): Levels {
  const levels = emptyLevels();
  for (const entry of entries) applyEntry(levels, entry);
  return levels;
}

/* ------------------------------ the figures ------------------------------- */

/**
 * Figures for one material.
 * `entries` oldest first, and only this material's; `requirements` only this material's.
 */
export function inventoryItemFor(
  material: MaterialInfo,
  entries: StockEntry[],
  requirements: RequirementFigures[],
  taskNames: Map<string, string>
): InventoryItem {
  const levels = levelsOf(entries);

  // Still needed: each requirement's total, minus what its own work item already used
  const stillNeeded = requirements.reduce(
    (sum, r) => sum + Math.max(0, totalRequired(r) - (levels.consumedByTask.get(r.taskId) ?? 0)),
    0
  );
  const incoming = requirements.reduce((sum, r) => sum + pendingQty(r), 0);

  const reservedByTask = [...levels.reservedByTask].map(([taskId, quantity]) => ({
    task: { id: taskId, name: taskNames.get(taskId) ?? "Work item" },
    quantity: round3(quantity),
  }));
  const reserved = reservedByTask.reduce((sum, r) => sum + r.quantity, 0);

  return {
    material,
    onHand: round3(levels.onHand),
    reserved: round3(reserved),
    available: round3(levels.onHand - reserved),
    consumed: round3(levels.consumed),
    stillNeeded: round3(stillNeeded),
    incoming: round3(incoming),
    shortage: round3(Math.max(0, stillNeeded - (levels.onHand + incoming))),
    reservedByTask,
  };
}

const groupBy = <T>(items: T[], key: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
};

/** Figures for every material that has stock activity or a requirement. `entries` oldest first. */
export function buildInventory(
  materials: MaterialInfo[],
  entries: StockEntry[],
  requirements: RequirementFigures[],
  taskNames: Map<string, string>
): InventoryItem[] {
  const entriesBy = groupBy(entries, (e) => e.materialId);
  const requirementsBy = groupBy(requirements, (r) => r.materialId);
  return materials
    .filter((m) => entriesBy.has(m.id) || requirementsBy.has(m.id))
    .map((m) => inventoryItemFor(m, entriesBy.get(m.id) ?? [], requirementsBy.get(m.id) ?? [], taskNames));
}

/* -------------------------------- validation ------------------------------ */

/** The rules a stock entry must follow: a message if it breaks one, otherwise null. Stock can never go below zero. */
export function validateMovement(item: InventoryItem, input: MovementCheck): string | null {
  const unit = item.material.unit;

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return "Enter a quantity greater than zero.";
  if (NEEDS_TASK[input.type] && !input.taskId) return "Choose the work item.";
  if (requiresNote(input.type) && input.note.trim().length < 3) return "Add a short note explaining the correction.";

  switch (input.type) {
    case "ISSUED":
    case "ADJUSTMENT_OUT":
      return input.quantity > item.onHand ? `Only ${formatQty(item.onHand, unit)} is in the store.` : null;
    case "RESERVED":
      return input.quantity > item.available ? `Only ${formatQty(item.available, unit)} is available to reserve.` : null;
    case "RELEASED": {
      const reserved = item.reservedByTask.find((r) => r.task.id === input.taskId)?.quantity ?? 0;
      return input.quantity > reserved ? `Only ${formatQty(reserved, unit)} is reserved for that work item.` : null;
    }
    default:
      return null;
  }
}
