/*
 * One contractor's month, like a monthly labour sheet: every labourer down the side, days 1–31 across, then their
 * hours, amount, overtime and total; and the account for the month (what was owed before, earned, paid, still owed).
 * No database here, so it is easy to test.
 */
import { round2, STANDARD_HOURS } from "./attendance.hourly.js";
export const daysIn = (month) => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
/**
 * A row per labourer: the team member when paid hourly, else the label. Rows are in the order people first appear
 * (those there from the 1st first, then who joined later), as on a paper sheet.
 */
export function monthSheet(month, entries) {
    const daysInMonth = daysIn(month);
    const rows = new Map();
    const extras = {};
    const dayTotals = {};
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const e of sorted) {
        const day = Number(e.date.slice(8, 10));
        if (e.extras)
            extras[day] = round2((extras[day] ?? 0) + e.extras);
        dayTotals[day] = round2((dayTotals[day] ?? 0) + e.totalAmount);
        for (const w of e.workers) {
            const hourly = w.hours !== null || w.otHours !== null;
            const key = w.memberId ? `m:${w.memberId}` : `${hourly ? "h" : "a"}:${w.label.trim().replace(/\s+/g, " ").toLowerCase()}`;
            let row = rows.get(key);
            if (!row) {
                row = { key, name: w.label, hourly, dayRate: null, hourlyRate: null, days: {}, hours: 0, otHours: 0, amount: 0, otAmount: 0, total: 0, exactAmount: 0, exactOt: 0 };
                rows.set(key, row);
            }
            row.name = w.label; // the latest spelling
            const cell = row.days[day] ?? { hours: hourly ? 0 : null, ot: hourly ? 0 : null, amount: 0 };
            cell.amount = round2(cell.amount + w.amount);
            row.total += w.amount;
            if (hourly) {
                const h = w.hours ?? 0;
                const ot = w.otHours ?? 0;
                const rate = w.hourlyRate ?? 0;
                cell.hours = (cell.hours ?? 0) + h;
                cell.ot = (cell.ot ?? 0) + ot;
                row.hours += h;
                row.otHours += ot;
                row.exactAmount += h * rate;
                row.exactOt += ot * rate;
                row.hourlyRate = rate;
                row.dayRate = round2(rate * STANDARD_HOURS);
            }
            else {
                row.exactAmount += w.amount;
            }
            row.days[day] = cell;
        }
    }
    const list = [...rows.values()].map(({ exactAmount, exactOt, ...r }) => ({
        ...r,
        hours: round2(r.hours),
        otHours: round2(r.otHours),
        amount: round2(exactAmount),
        otAmount: round2(exactOt),
        total: round2(r.total),
    }));
    const sum = (pick) => round2(list.reduce((s, r) => s + pick(r), 0));
    const extrasTotal = round2(Object.values(extras).reduce((s, v) => s + v, 0));
    return {
        daysInMonth,
        rows: list,
        extras,
        extrasTotal,
        dayTotals,
        totals: { hours: sum((r) => r.hours), otHours: sum((r) => r.otHours), amount: sum((r) => r.amount), otAmount: sum((r) => r.otAmount), total: round2(sum((r) => r.total) + extrasTotal) },
    };
}
/** Owed from before + earned this month − paid this month = carried to next month */
export function statement(earnedBefore, paidBefore, earned, payments) {
    const opening = round2(earnedBefore - paidBefore);
    const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
    return { opening, earned: round2(earned), payments, paid, closing: round2(opening + earned - paid) };
}
//# sourceMappingURL=attendance.month.calc.js.map