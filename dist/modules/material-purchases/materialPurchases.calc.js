/** Pure figures for the simple Materials tab (no database), so they can be tested on their own */
export const round2 = (n) => Math.round(n * 100) / 100;
/** 5000 bricks at ₹8.50 = ₹42,500 */
export const amountOf = (quantity, rate) => round2(quantity * rate);
/** "bricks " and "Bricks" are the same material: reuse the spelling already on the list */
export function canonicalName(typed, known) {
    const clean = typed.trim().replace(/\s+/g, " ");
    return known.find((k) => k.toLowerCase() === clean.toLowerCase()) ?? clean;
}
/** The total, and each material's quantity and amount (biggest spend first) */
export function summarize(lines) {
    const by = new Map();
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
/**
 * The BOQ's materials, one line per material per section (two items of one sheet that both need cement are one line),
 * in the BOQ's own order, each marked when the list already has it under that section.
 */
export function boqLines(needs, existing) {
    const key = (section, name) => `${section.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
    const have = new Set(existing.map((e) => key(e.section, e.name)));
    const lines = new Map();
    for (const n of needs) {
        if (!(n.quantity > 0))
            continue;
        const k = `${n.section.trim().toLowerCase()}|${n.materialId}`;
        const line = lines.get(k) ?? { section: n.section.trim(), materialId: n.materialId, name: n.name, unit: n.unit, quantity: 0, rate: n.rate, amount: 0, added: have.has(key(n.section, n.name)) };
        line.quantity += n.quantity;
        lines.set(k, line);
    }
    return [...lines.values()].map((l) => {
        const quantity = Math.round(l.quantity * 1000) / 1000;
        return { ...l, quantity, amount: amountOf(quantity, l.rate) };
    });
}
/** 5,000 ordered, 3,000 arrived → 2,000 to come. More than ordered is allowed and shown as extra. */
export function arrivalOf(ordered, deliveries) {
    const r3 = (n) => Math.round(n * 1000) / 1000;
    const arrived = r3(deliveries.reduce((s, d) => s + d.quantity, 0));
    const toCome = r3(Math.max(0, ordered - arrived));
    const extra = r3(Math.max(0, arrived - ordered));
    const state = arrived <= 0 ? "none" : extra > 0 ? "extra" : toCome > 0 ? "part" : "all";
    return { arrived, toCome, extra, state };
}
//# sourceMappingURL=materialPurchases.calc.js.map