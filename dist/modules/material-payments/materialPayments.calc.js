/*
 * Money and material vendors on one project, without the database so it is easy to test: for each vendor, what
 * was bought from them (the value of what they delivered), what was paid, and what is still owed.
 */
const key = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
const r2 = (n) => Math.round(n * 100) / 100;
/** "  shree   TRADERS " typed today becomes "Shree Traders" if that name is already known */
export function canonicalVendor(raw, known) {
    const clean = raw.trim().replace(/\s+/g, " ");
    return known.find((k) => key(k) === key(clean)) ?? clean;
}
/** One line per vendor, names matched whatever the case or spacing; most still owed first */
export function vendorLedger(bought, paid) {
    const lines = new Map();
    const line = (name) => {
        const k = key(name);
        let l = lines.get(k);
        if (!l) {
            l = { vendorName: name.trim(), bought: 0, paid: 0, balance: 0, lastPaid: null };
            lines.set(k, l);
        }
        return l;
    };
    for (const b of bought)
        if (b.vendorName.trim())
            line(b.vendorName).bought += b.total;
    for (const p of paid) {
        const l = line(p.vendorName);
        l.paid += p.total;
        if (!l.lastPaid || p.date > l.lastPaid)
            l.lastPaid = p.date;
    }
    return [...lines.values()]
        .map((l) => ({ ...l, bought: r2(l.bought), paid: r2(l.paid), balance: r2(l.bought - l.paid) }))
        .sort((a, b) => b.balance - a.balance || a.vendorName.localeCompare(b.vendorName));
}
//# sourceMappingURL=materialPayments.calc.js.map