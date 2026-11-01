/**
 * Material tiles and material sheets, with no database in them, so they are unit-tested.
 * The quantities come from the stock figures (buildInventory) and the money from the material cost (materialCosts),
 * so the sheet always agrees with the Inventory page's stock, orders and cost tabs.
 */
import type { InventoryItem } from "./stock.js";
import type { MaterialCost } from "./cost.js";

/* ------------------------------ which tile ------------------------------ */

/**
 * The client's tiles first, in their order. A material goes to one of them when its category says so
 * (e.g. category "Steel"), otherwise when its name does ("TMT 12 mm" → Steel). Anything else gets a tile named
 * after its own category. Concrete is checked before cement, so "Cement concrete M20" lands in RMC / CC.
 */
const NAMED = [
  { key: "bricks", label: "Bricks", match: /\bbricks?\b|\bblocks?\b|\bfly ?ash\b/ },
  { key: "steel", label: "Steel", match: /\bsteel\b|\btmt\b|\brebars?\b|\bfe ?(415|500|550)\b/ },
  { key: "rmc", label: "RMC / CC", match: /\brmc\b|ready[- ]?mix|\bpcc\b|\brcc\b|\bconcrete\b|\bcc\b/ },
  { key: "sand", label: "Sand", match: /\bsand\b|\bm-?sand\b/ },
  { key: "cement", label: "Cement", match: /\bcement\b|\bopc\b|\bppc\b/ },
] as const;
const CHECK_ORDER = ["rmc", "cement", "steel", "bricks", "sand"] as const;
const byKey = new Map(NAMED.map((t) => [t.key, t]));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "other";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function tileFor(material: { name: string; category: string }): { key: string; label: string } {
  const category = norm(material.category);
  for (const t of NAMED) if (category === norm(t.label) || category === t.key) return { key: t.key, label: t.label };
  const name = material.name.toLowerCase();
  for (const key of CHECK_ORDER) {
    const t = byKey.get(key)!;
    if (t.match.test(name)) return { key: t.key, label: t.label };
  }
  const own = material.category.trim();
  return own && norm(own) !== "general" ? { key: slug(own), label: own } : { key: "other", label: "Other" };
}

/** The client's tiles first in their order, then the rest by name, "Other" last */
const RANK: ReadonlyMap<string, number> = new Map(NAMED.map((t, i) => [t.key, i]));
const tileRank = (key: string) => RANK.get(key) ?? (key === "other" ? 1000 : 100);

/* -------------------------------- orders -------------------------------- */

export interface OrderRow {
  id: string;
  materialId: string;
  vendor: string | null;
  quantity: number;
  receivedQty: number;
  rate: number;
  expectedDelivery: string | null; // YYYY-MM-DD
  reference: string;
  createdAt: string; // YYYY-MM-DD
}

export type OrderState = "received" | "part" | "waiting" | "late";

export function orderState(o: Pick<OrderRow, "quantity" | "receivedQty" | "expectedDelivery">, today: string): OrderState {
  if (o.receivedQty >= o.quantity - 1e-9) return "received";
  if (o.expectedDelivery && o.expectedDelivery < today) return "late";
  return o.receivedQty > 0 ? "part" : "waiting";
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/* -------------------------------- sheets -------------------------------- */

export interface SheetMaterial {
  material: { id: string; name: string; unit: string };
  rate: number; // standard rate per unit
  required: number; // what the BOQ needs (wastage included)
  budget: number; // required × rate
  ordered: number;
  received: number;
  utilised: number; // issued to site work
  inStore: number;
  pendingDelivery: number; // ordered, not yet arrived
  pendingOrder: number; // still needed beyond the store and what's on its way
  spent: number;
  averageRate: number | null;
  vendors: string[];
  orders: (OrderRow & { number: number; amount: number; state: OrderState })[];
}

export interface Tile {
  key: string;
  label: string;
  materials: number;
  budget: number;
  spent: number;
  /** Set when every material in the tile has the same unit, so quantities can be added up */
  quantity: { unit: string; required: number; utilised: number; received: number } | null;
  toOrder: number; // materials with something still to order
  lateOrders: number;
  arriving: number; // orders still to arrive (not late)
}

export function materialBook(stock: InventoryItem[], costs: MaterialCost[], orders: OrderRow[], today: string) {
  const costOf = new Map(costs.map((c) => [c.material.id, c]));
  const ordersOf = new Map<string, OrderRow[]>();
  for (const o of [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const list = ordersOf.get(o.materialId) ?? [];
    list.push(o);
    ordersOf.set(o.materialId, list);
  }

  const sheets = new Map<string, { key: string; label: string; materials: SheetMaterial[] }>();
  for (const item of stock) {
    const tile = tileFor(item.material);
    const cost = costOf.get(item.material.id);
    const mine = (ordersOf.get(item.material.id) ?? []).map((o, i) => ({ ...o, number: i + 1, amount: r2(o.quantity * o.rate), state: orderState(o, today) }));
    const row: SheetMaterial = {
      material: { id: item.material.id, name: item.material.name, unit: item.material.unit },
      rate: cost?.standardRate ?? 0,
      required: item.required,
      budget: cost?.budget ?? 0,
      ordered: item.ordered,
      received: cost?.received ?? 0,
      utilised: item.issued,
      inStore: item.onHand,
      pendingDelivery: item.incoming,
      pendingOrder: item.toOrder,
      spent: cost?.spent ?? 0,
      averageRate: cost?.averageRate ?? null,
      vendors: [...new Set(mine.map((o) => o.vendor).filter((v): v is string => !!v))],
      orders: mine,
    };
    const sheet = sheets.get(tile.key) ?? { key: tile.key, label: tile.label, materials: [] };
    sheet.materials.push(row);
    sheets.set(tile.key, sheet);
  }

  const ordered = [...sheets.values()].sort((a, b) => tileRank(a.key) - tileRank(b.key) || a.label.localeCompare(b.label));
  for (const s of ordered) s.materials.sort((a, b) => b.budget - a.budget || a.material.name.localeCompare(b.material.name));

  const tiles: Tile[] = ordered.map((s) => {
    const units = new Set(s.materials.map((m) => m.material.unit));
    const sum = (pick: (m: SheetMaterial) => number) => s.materials.reduce((t, m) => t + pick(m), 0);
    const allOrders = s.materials.flatMap((m) => m.orders);
    return {
      key: s.key,
      label: s.label,
      materials: s.materials.length,
      budget: r2(sum((m) => m.budget)),
      spent: r2(sum((m) => m.spent)),
      quantity: units.size === 1 ? { unit: [...units][0]!, required: r3(sum((m) => m.required)), utilised: r3(sum((m) => m.utilised)), received: r3(sum((m) => m.received)) } : null,
      toOrder: s.materials.filter((m) => m.pendingOrder > 0).length,
      lateOrders: allOrders.filter((o) => o.state === "late").length,
      arriving: allOrders.filter((o) => o.state === "waiting" || o.state === "part").length,
    };
  });

  return { tiles, sheets: Object.fromEntries(ordered.map((s) => [s.key, s])) };
}

export type MaterialBook = ReturnType<typeof materialBook>;
