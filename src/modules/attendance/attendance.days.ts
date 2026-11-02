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