/*
 * The labour pay week, worked out without the database so every rule is easy to test.
 *
 * A pay week runs Monday to Sunday (the team head is paid on Sunday). For each contractor (in a trade):
 *   from last week  = everything earned before this week − everything paid before this week
 *   earned          = attendance this week + contract work measured this week
 *   to pay          = from last week + earned
 *   paid            = payments dated this week (any amount: part, all, or more)
 *   left            = to pay − paid  → becomes next week's "from last week"
 * "Settle week" closes the week for that contractor: its attendance and measurements can no longer change, and the
 * next week starts fresh with only the amount left carried over.
 */
export const round2 = (n) => Math.round(n * 100) / 100;
export const nameKey = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
export const lineKey = (trade, contractorName) => `${nameKey(trade)}|${nameKey(contractorName)}`;
const asDate = (ymd) => new Date(`${ymd}T00:00:00Z`);
export const ymdOf = (d) => d.toISOString().slice(0, 10);
/** "2026-11-05" (a Thursday) → "2026-11-02", the Monday that starts its pay week */
export function weekStartOf(ymd) {
    const d = asDate(ymd);
    const back = (d.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
    d.setUTCDate(d.getUTCDate() - back);
    return ymdOf(d);
}
export function addDays(ymd, n) {
    const d = asDate(ymd);
    d.setUTCDate(d.getUTCDate() + n);
    return ymdOf(d);
}
/** The seven days of the week that starts on `start` */
export const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
/** Every pay week (its Monday) that touches the given days, without repeats */
export const weeksOf = (days) => [...new Set(days.map(weekStartOf))].sort();
/** Pay weeks that touch a month ("2026-11"): the Mondays from the week of the 1st to the week of the last day */
export function weeksInMonth(month) {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const out = [];
    for (let w = weekStartOf(`${month}-01`); w <= `${month}-${String(last).padStart(2, "0")}`; w = addDays(w, 7))
        out.push(w);
    return out;
}
const ZERO = () => ({
    days: [0, 0, 0, 0, 0, 0, 0],
    attendance: 0,
    contract: 0,
    earned: 0,
    fromLastWeek: 0,
    toPay: 0,
    paid: 0,
    left: 0,
});
/**
 * One line per contractor and trade with anything to show this week: work done, a payment, a balance carried in, or
 * a settled week. Names and trades match whatever the case or spacing. Most still to pay first; settled ones last.
 */
export function weekLines(input) {
    const days = weekDays(input.start);
    const map = new Map();
    const line = (r) => {
        const k = lineKey(r.trade, r.contractorName);
        let l = map.get(k);
        if (!l) {
            l = { key: k, trade: r.trade.trim(), contractorName: r.contractorName.trim(), settled: null, ...ZERO() };
            map.set(k, l);
        }
        return l;
    };
    for (const r of input.attendanceBefore)
        line(r).fromLastWeek += r.amount;
    for (const r of input.contractBefore)
        line(r).fromLastWeek += r.amount;
    for (const r of input.paidBefore)
        line(r).fromLastWeek -= r.amount;
    for (const r of input.attendanceThisWeek) {
        const l = line(r);
        l.attendance += r.amount;
        const i = days.indexOf(r.date);
        if (i >= 0)
            l.days[i] += r.amount;
    }
    for (const r of input.contractThisWeek)
        line(r).contract += r.amount;
    for (const r of input.paidThisWeek)
        line(r).paid += r.amount;
    for (const s of input.settled)
        line(s).settled = { at: s.settledAt, by: s.settledBy };
    const lines = [...map.values()]
        .map((l) => {
        const fromLastWeek = round2(l.fromLastWeek);
        const earned = round2(l.attendance + l.contract);
        const toPay = round2(fromLastWeek + earned);
        const paid = round2(l.paid);
        return { ...l, days: l.days.map(round2), attendance: round2(l.attendance), contract: round2(l.contract), earned, fromLastWeek, toPay, paid, left: round2(toPay - paid) };
    })
        // Nothing this week and nothing carried: leave out (old, fully paid contractors)
        .filter((l) => l.earned !== 0 || l.paid !== 0 || Math.abs(l.fromLastWeek) >= 0.01 || l.settled)
        .sort((a, b) => Number(!!a.settled) - Number(!!b.settled) || b.left - a.left || a.contractorName.localeCompare(b.contractorName));
    const sum = (pick) => round2(lines.reduce((s, l) => s + pick(l), 0));
    return {
        lines,
        totals: {
            attendance: sum((l) => l.attendance),
            contract: sum((l) => l.contract),
            earned: sum((l) => l.earned),
            fromLastWeek: sum((l) => l.fromLastWeek),
            toPay: sum((l) => l.toPay),
            paid: sum((l) => l.paid),
            left: sum((l) => l.left),
        },
    };
}
/** Contract work: area × rate, to the paisa */
export const measureAmount = (quantity, rate) => round2(quantity * rate);
/**
 * The month for every contractor at once ("Total" view): earned by pay week, attendance and contract work, paid.
 * Rows outside the month are ignored; a week that starts in the previous month only counts its days in this month.
 */
export function monthLines(month, attendance, contract, paid) {
    const weeks = weeksInMonth(month);
    const inMonth = (d) => d.startsWith(`${month}-`);
    const map = new Map();
    const line = (r) => {
        const k = lineKey(r.trade, r.contractorName);
        let l = map.get(k);
        if (!l) {
            l = { key: k, trade: r.trade.trim(), contractorName: r.contractorName.trim(), byWeek: weeks.map(() => 0), attendance: 0, contract: 0, earned: 0, paid: 0 };
            map.set(k, l);
        }
        return l;
    };
    const addEarned = (r, field) => {
        if (!inMonth(r.date))
            return;
        const l = line(r);
        l[field] += r.amount;
        const w = weeks.indexOf(weekStartOf(r.date));
        if (w >= 0)
            l.byWeek[w] += r.amount;
    };
    for (const r of attendance)
        addEarned(r, "attendance");
    for (const r of contract)
        addEarned(r, "contract");
    for (const r of paid)
        if (inMonth(r.date))
            line(r).paid += r.amount;
    const lines = [...map.values()]
        .map((l) => ({ ...l, byWeek: l.byWeek.map(round2), attendance: round2(l.attendance), contract: round2(l.contract), earned: round2(l.attendance + l.contract), paid: round2(l.paid) }))
        .sort((a, b) => b.earned - a.earned || a.contractorName.localeCompare(b.contractorName));
    const sum = (pick) => round2(lines.reduce((s, l) => s + pick(l), 0));
    return {
        weeks,
        lines,
        totals: {
            byWeek: weeks.map((_, i) => round2(lines.reduce((s, l) => s + l.byWeek[i], 0))),
            attendance: sum((l) => l.attendance),
            contract: sum((l) => l.contract),
            earned: sum((l) => l.earned),
            paid: sum((l) => l.paid),
        },
    };
}
//# sourceMappingURL=labour-weeks.calc.js.map