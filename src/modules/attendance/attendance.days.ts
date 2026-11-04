/**
 * Several days in one go, with a different amount for each labourer on each day. No database in it, so it is
 * easy to test. A labourer's `amounts` holds the amount for each day; a day it doesn't list uses `amount`.
 */
export interface BulkWorker {
  label: string;
  amount: number;
  amounts?: Record<string, number>; // "YYYY-MM-DD" -> amount paid that day
}

/** The labourers and their amounts for one day, in the shape a single entry is saved in */
export const workersOn = (workers: BulkWorker[], date: string) =>
  workers.map((w) => ({ label: w.label, amount: w.amounts?.[date] ?? w.amount }));

/** Days where nothing at all would be paid (every amount and the extras are 0): saving them would only add noise */
export const emptyDays = (workers: BulkWorker[], dates: string[], extras: number) =>
  extras > 0 ? [] : dates.filter((date) => workersOn(workers, date).every((w) => w.amount === 0));

/**
 * Old entries saved before batches existed: finds the days that were saved together, so they can be given a batch.
 * Days count as saved together when everything but the date and amounts is the same (project, who entered them,
 * contractor, trade, extras, notes) and each was saved within `gapMs` of the one before: the old bulk save wrote
 * them one after another within a second, while two entries typed by hand are always further apart.
 */
export interface SavedRow {
  id: string;
  projectId: string;
  ownerId: string;
  contractorName: string;
  trade: string;
  notes: string;
  extras: number;
  date: string; // YYYY-MM-DD
  createdAt: number; // ms
}

export function savedTogether(rows: SavedRow[], gapMs = 5_000): { lead: string; ids: string[] }[] {
  const key = (r: SavedRow) => [r.projectId, r.ownerId, r.contractorName.trim().toLowerCase(), r.trade, r.notes, r.extras].join("\u0000");
  const sorted = [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.createdAt - b.createdAt));
  const groups: SavedRow[][] = [];
  for (const r of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && key(prev) === key(r) && r.createdAt - prev.createdAt <= gapMs && !last.some((x) => x.date === r.date)) last.push(r);
    else groups.push([r]);
  }
  return groups
    .filter((g) => g.length > 1)
    .map((g) => {
      const byDate = [...g].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return { lead: byDate[0]!.id, ids: byDate.map((r) => r.id) };
    });
}