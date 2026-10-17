/** "2026-11-05" -> a Date at UTC midnight, which is how @db.Date columns are stored */
export const toDate = (day) => new Date(`${day}T00:00:00.000Z`);
/** A @db.Date value -> "2026-11-05" */
export const toDay = (date) => date.toISOString().slice(0, 10);
//# sourceMappingURL=dates.js.map