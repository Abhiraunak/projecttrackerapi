import { Attendance, AttendanceWorker } from "../../generated/prisma/client.js";




type Row = Attendance & {
  project: { id: string; title: string };
  workers: AttendanceWorker[];
};

const day = (d: Date) => d.toISOString().slice(0, 10);
export const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`); // @db.Date columns are UTC midnight

export const attendanceDto = (a: Row) => ({
  id: a.id,
  projectId: a.projectId,
  project: a.project,
  contractorName: a.contractorName,
  date: day(a.date),
  workers: a.workers.map((w) => ({ id: w.id, label: w.label, amount: w.amount.toNumber() })),
  extras: a.extras.toNumber(),
  notes: a.notes,
  totalAmount: a.totalAmount.toNumber(),
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});