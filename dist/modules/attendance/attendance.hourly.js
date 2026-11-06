/*
 * The two ways a contractor's team is paid, worked out without the database so every rule can be tested:
 *   "amount"  ("Paid monthly"): the rupees typed for each labourer on each day, as before;
 *   "hourly"  ("Paid hourly"):  hours + overtime on each day × the labourer's rate, like a monthly labour sheet.
 * A day rate is for a standard 8-hour day, so ₹1,300 a day is ₹162.50 an hour; overtime is paid at the same rate.
 */
export const STANDARD_HOURS = 8;
export const PAY_MODES = ["amount", "hourly"];
export const round2 = (n) => Math.round(n * 100) / 100;
export const hourlyRateOf = (dayRate) => dayRate / STANDARD_HOURS;
/** What one labourer earns on one day: (hours + OT) × hourly rate */
export const payFor = (hours, otHours, dayRate) => round2((hours + otHours) * hourlyRateOf(dayRate));
export const nameKey = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
/**
 * Who was paid what on one day (`date` undefined: a single-day entry, read from `amount` / `hours`).
 * Paid hourly: someone with no hours and no overtime that day was absent, and is left out of that day.
 */
export function rowsOn(mode, workers, date, memberIds = new Map()) {
    if (mode === "amount") {
        return workers.map((w) => ({ label: w.label, amount: date ? (w.amounts?.[date] ?? w.amount) : w.amount, memberId: null, hours: null, otHours: null, hourlyRate: null }));
    }
    return workers.flatMap((w) => {
        const hours = (date ? w.hoursByDay?.[date] : w.hours) ?? 0;
        const otHours = (date ? w.otByDay?.[date] : w.otHours) ?? 0;
        if (hours + otHours === 0)
            return []; // absent
        const dayRate = w.dayRate ?? 0;
        return [{ label: w.label, amount: payFor(hours, otHours, dayRate), memberId: memberIds.get(nameKey(w.label)) ?? null, hours, otHours, hourlyRate: hourlyRateOf(dayRate) }];
    });
}
/** Days where nothing at all would be paid: saving them would only add noise */
export const emptyDaysFor = (mode, workers, dates, extras) => extras > 0 ? [] : dates.filter((d) => rowsOn(mode, workers, d).every((r) => r.amount === 0));
/** Hourly: labourers who worked but have no day rate yet (their pay would come out as 0) */
export function missingRates(mode, workers) {
    if (mode !== "hourly")
        return [];
    const worked = (w) => (w.hours ?? 0) + (w.otHours ?? 0) > 0 || Object.values(w.hoursByDay ?? {}).some((h) => h > 0) || Object.values(w.otByDay ?? {}).some((h) => h > 0);
    return workers.filter((w) => worked(w) && !(w.dayRate && w.dayRate > 0)).map((w) => w.label);
}
/** The same name typed twice for one entry would pay someone twice */
export function repeatedNames(mode, workers) {
    if (mode !== "hourly")
        return [];
    const seen = new Map();
    for (const w of workers)
        seen.set(nameKey(w.label), (seen.get(nameKey(w.label)) ?? 0) + 1);
    return workers.filter((w, i, all) => (seen.get(nameKey(w.label)) ?? 0) > 1 && all.findIndex((x) => nameKey(x.label) === nameKey(w.label)) === i).map((w) => w.label);
}
//# sourceMappingURL=attendance.hourly.js.map