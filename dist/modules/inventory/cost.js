/**
 * What a project's materials cost, with no database in it:
 *   budget     what the BOQ needs × the material's standard rate
 *   ordered    the value of all orders (quantity × the order's rate)
 *   spent      the value of what has arrived: received on orders × the order's rate, plus deliveries recorded
 *              without an order, valued at the standard rate (that part is shown as "estimated")
 *   expected   what the material will most likely cost in the end: the budget, or more if orders and
 *              deliveries already go past it
 */
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
export function materialCosts({ materials, required, orders, receivedWithoutOrder }) {
    const items = [];
    for (const m of materials) {
        const mine = orders.filter((o) => o.materialId === m.id);
        const need = required.get(m.id) ?? 0;
        const loose = receivedWithoutOrder.get(m.id) ?? 0;
        if (need === 0 && mine.length === 0 && loose === 0)
            continue;
        const orderedValue = round2(mine.reduce((s, o) => s + o.quantity * o.rate, 0));
        const estimated = round2(loose * m.rate);
        const spent = round2(mine.reduce((s, o) => s + o.receivedQty * o.rate, 0) + estimated);
        const received = round3(mine.reduce((s, o) => s + o.receivedQty, 0) + loose);
        const budget = round2(need * m.rate);
        const expected = round2(Math.max(budget, orderedValue + estimated, spent));
        items.push({
            material: { id: m.id, name: m.name, unit: m.unit },
            standardRate: m.rate,
            required: round3(need),
            budget,
            ordered: round3(mine.reduce((s, o) => s + o.quantity, 0)),
            orderedValue,
            received,
            spent,
            estimated,
            averageRate: received > 0 ? round2(spent / received) : null,
            expected,
            overBudget: budget > 0 && expected > budget + 0.005,
        });
    }
    const sum = (pick) => round2(items.reduce((s, c) => s + pick(c), 0));
    return {
        items: items.sort((a, b) => b.expected - a.expected),
        totals: {
            budget: sum((c) => c.budget),
            orderedValue: sum((c) => c.orderedValue),
            spent: sum((c) => c.spent),
            estimated: sum((c) => c.estimated),
            expected: sum((c) => c.expected),
            missingRates: items.filter((c) => c.required > 0 && c.standardRate === 0).length,
        },
    };
}
//# sourceMappingURL=cost.js.map