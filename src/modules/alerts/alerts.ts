/**
 * Stock alerts, with no database in it. An alert has a key that stays the same while its cause lasts,
 * so the same shortage is never announced twice, and it closes by itself when the cause goes away.
 */
import type { InventoryItem } from "../inventory/stock.js";

export type AlertKind = "ORDER_MORE" | "LOW_STOCK" | "LATE_DELIVERY";

export interface Alert {
  key: string;
  kind: AlertKind;
  materialId: string | null;
  orderId: string | null;
  message: string;
}

export interface AlertOrder {
  id: string;
  materialId: string;
  materialName: string;
  unit: string;
  reference: string;
  vendorName: string | null;
  pendingQty: number;
  expectedDelivery: string | null; // YYYY-MM-DD
}

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

/** Every alert that holds right now. `today` is YYYY-MM-DD in the company's time zone. */
export function computeAlerts(stock: InventoryItem[], orders: AlertOrder[], today: string): Alert[] {
  const alerts: Alert[] = [];
  for (const s of stock) {
    const { id, name, unit, minStock } = s.material;
    if (s.toOrder > 0) {
      alerts.push({
        key: `order:${id}`,
        kind: "ORDER_MORE",
        materialId: id,
        orderId: null,
        message: `Order ${fmt(s.toOrder)} ${unit} more ${name}: the BOQ still needs it beyond the store and open orders`,
      });
    }
    if (minStock > 0 && s.onHand <= minStock && s.stillNeeded > s.onHand) {
      alerts.push({
        key: `low:${id}`,
        kind: "LOW_STOCK",
        materialId: id,
        orderId: null,
        message: `${name} is low in the store: ${fmt(s.onHand)} ${unit} left (minimum ${fmt(minStock)})`,
      });
    }
  }
  for (const o of orders) {
    if (o.pendingQty > 0 && o.expectedDelivery && o.expectedDelivery < today) {
      alerts.push({
        key: `late:${o.id}`,
        kind: "LATE_DELIVERY",
        materialId: o.materialId,
        orderId: o.id,
        message: `${o.materialName} is late: ${fmt(o.pendingQty)} ${o.unit} was due ${o.expectedDelivery}${o.vendorName ? ` from ${o.vendorName}` : ""}${o.reference ? ` (${o.reference})` : ""}`,
      });
    }
  }
  return alerts;
}

export interface OpenAlert {
  id: string;
  key: string;
  message: string;
}

/** What to open, close and re-word, given the alerts open now and the ones that hold now */
export function diffAlerts(open: OpenAlert[], current: Alert[]) {
  const currentKeys = new Map(current.map((a) => [a.key, a]));
  const openKeys = new Set(open.map((a) => a.key));
  return {
    create: current.filter((a) => !openKeys.has(a.key)),
    resolve: open.filter((a) => !currentKeys.has(a.key)).map((a) => a.id),
    reword: open.flatMap((a) => {
      const now = currentKeys.get(a.key);
      return now && now.message !== a.message ? [{ id: a.id, message: now.message }] : [];
    }),
  };
}

/** The same alert is pushed at most once a day, even if it closes and opens again (stock issued, then received) */
export const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const shouldNotify = (lastNotifiedAt: Date | null, now: Date) => !lastNotifiedAt || now.getTime() - lastNotifiedAt.getTime() >= NOTIFY_COOLDOWN_MS;

/** Today in India (the company's time zone), as YYYY-MM-DD: a delivery due "today" isn't late until tomorrow */
export const todayInIndia = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
