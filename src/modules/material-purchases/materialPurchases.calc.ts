/** Pure figures for the simple Materials tab (no database), so they can be tested on their own */

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** 5000 bricks at ₹8.50 = ₹42,500 */
export const amountOf = (quantity: number, rate: number) => round2(quantity * rate);

/** "bricks " and "Bricks" are the same material: reuse the spelling already on the list */
export function canonicalName(typed: string, known: string[]): string {
  const clean = typed.trim().replace(/\s+/g, " ");
  return known.find((k) => k.toLowerCase() === clean.toLowerCase()) ?? clean;
}

export interface PurchaseLine {
  name: string;
  unit: string;
  quantity: number;
  amount: number;
}

/** The total, and each material's quantity and amount (biggest spend first) */
export function summarize(lines: PurchaseLine[]) {
  const by = new Map<string, { name: string; unit: string; quantity: number; amount: number; entries: number }>();
  for (const l of lines) {
    const key = `${l.name.toLowerCase()}|${l.unit.toLowerCase()}`;
    const m = by.get(key) ?? { name: l.name, unit: l.unit, quantity: 0, amount: 0, entries: 0 };
    m.quantity += l.quantity;
    m.amount += l.amount;
    m.entries += 1;
    by.set(key, m);
  }
  const materials = [...by.values()]
    .map((m) => ({ ...m, quantity: Math.round(m.quantity * 1000) / 1000, amount: round2(m.amount) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return { total: round2(lines.reduce((s, l) => s + l.amount, 0)), entries: lines.length, materials };
}