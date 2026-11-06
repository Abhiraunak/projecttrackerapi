/** The labourers and their amounts for one day, in the shape a single entry is saved in */
export const workersOn = (workers, date) => workers.map((w) => ({ label: w.label, amount: w.amounts?.[date] ?? w.amount }));
/** Days where nothing at all would be paid (every amount and the extras are 0): saving them would only add noise */
export const emptyDays = (workers, dates, extras) => extras > 0 ? [] : dates.filter((date) => workersOn(workers, date).every((w) => w.amount === 0));
export function savedTogether(rows, gapMs = 5_000) {
    const key = (r) => [r.projectId, r.ownerId, r.contractorName.trim().toLowerCase(), r.trade, r.notes, r.extras].join("\u0000");
    const sorted = [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.createdAt - b.createdAt));
    const groups = [];
    for (const r of sorted) {
        const last = groups[groups.length - 1];
        const prev = last?.[last.length - 1];
        if (last && prev && key(prev) === key(r) && r.createdAt - prev.createdAt <= gapMs && !last.some((x) => x.date === r.date))
            last.push(r);
        else
            groups.push([r]);
    }
    return groups
        .filter((g) => g.length > 1)
        .map((g) => {
        const byDate = [...g].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        return { lead: byDate[0].id, ids: byDate.map((r) => r.id) };
    });
}
//# sourceMappingURL=attendance.days.js.map