/** The labourers and their amounts for one day, in the shape a single entry is saved in */
export const workersOn = (workers, date) => workers.map((w) => ({ label: w.label, amount: w.amounts?.[date] ?? w.amount }));
/** Days where nothing at all would be paid (every amount and the extras are 0): saving them would only add noise */
export const emptyDays = (workers, dates, extras) => extras > 0 ? [] : dates.filter((date) => workersOn(workers, date).every((w) => w.amount === 0));
//# sourceMappingURL=attendance.days.js.map