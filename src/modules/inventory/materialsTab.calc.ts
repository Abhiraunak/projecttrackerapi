/*
 * The Materials tab, worked out without the database:
 *  - which section each material is listed under (the section that needs most of it; "also in" the others);
 *  - received and issued per month for the bar graph: by value (₹, all materials together, since kg and bags can't
 *    be added) or by quantity for one material;
 *  - the three totals under the graph.
 */

export const ADDED_BY_HAND = "Added by hand";
export const OTHER = "Other materials";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The last `n` months, oldest first, ending with the month of `today` ("2026-11-03" → […, "2026-10", "2026-11"]) */
export function lastMonths(today: string, n = 12): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y!, m! - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export interface Move {
  materialId: string;
  type: "RECEIVED" | "ISSUED" | "RESERVED" | "RELEASED" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
  quantity: number;
  day: string; // YYYY-MM-DD
}

export interface Series {
  received: number[];
  issued: number[];
}

/** Received and issued per month; `weight` turns a quantity into what is plotted (its value, or 1 for the quantity) */
export function monthly(moves: Move[], months: string[], weight: (materialId: string) => number): Series {
  const at = new Map(months.map((m, i) => [m, i]));
  const received = months.map(() => 0);
  const issued = months.map(() => 0);
  for (const mv of moves) {
    const i = at.get(mv.day.slice(0, 7));
    if (i === undefined) continue;
    if (mv.type === "RECEIVED") received[i]! += mv.quantity * weight(mv.materialId);
    else if (mv.type === "ISSUED") issued[i]! += mv.quantity * weight(mv.materialId);
  }
  return { received: received.map(r2), issued: issued.map(r2) };
}

/** Where a material is listed: the section needing most of it; the rest are "also in" */
export function sectionOf(needs: { section: string; required: number }[]): { section: string; alsoIn: string[] } {
  const by = new Map<string, number>();
  for (const n of needs) by.set(n.section, (by.get(n.section) ?? 0) + n.required);
  const ranked = [...by].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  return { section: ranked[0] ?? OTHER, alsoIn: ranked.slice(1) };
}

export interface ListMaterial {
  id: string;
  name: string;
  unit: string;
  rate: number;
  section: string;
  alsoIn: string[];
  needed: number;
  inStock: number;
  issued: number;
  received: number;
  lastIssued: string | null;
  low: boolean; // at or under its minimum stock
}

/**
 * Sections in a steady order: the BOQ's sections in the order given, then hand-added ones (A–Z), then
 * "Added by hand", then "Other materials" (bought or in store, but not needed by anything yet).
 */
export function groupBySection(materials: ListMaterial[], sectionOrder: string[]) {
  const rank = (s: string) => {
    if (s === OTHER) return 1e9;
    if (s === ADDED_BY_HAND) return 1e9 - 1;
    const i = sectionOrder.indexOf(s);
    return i >= 0 ? i : 1e6;
  };
  const groups = new Map<string, ListMaterial[]>();
  for (const m of materials) groups.set(m.section, [...(groups.get(m.section) ?? []), m]);
  return [...groups]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([name, list]) => ({ name, materials: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Under the graph: received and issued this month (₹), and what the store holds now (₹) */
export function totals(series: Series, materials: ListMaterial[]) {
  const last = series.received.length - 1;
  return {
    receivedThisMonth: series.received[last] ?? 0,
    issuedThisMonth: series.issued[last] ?? 0,
    stockValue: r2(materials.reduce((s, m) => s + m.inStock * m.rate, 0)),
  };
}

/** For one material: received, issued and the last day it was issued, from its moves */
export function moveFigures(moves: Move[]) {
  let received = 0;
  let issued = 0;
  let lastIssued: string | null = null;
  for (const mv of moves) {
    if (mv.type === "RECEIVED") received += mv.quantity;
    if (mv.type === "ISSUED") {
      issued += mv.quantity;
      if (!lastIssued || mv.day > lastIssued) lastIssued = mv.day;
    }
  }
  return { received: r3(received), issued: r3(issued), lastIssued };
}