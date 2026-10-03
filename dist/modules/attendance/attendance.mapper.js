const day = (d) => d.toISOString().slice(0, 10);
export const toDate = (s) => new Date(`${s}T00:00:00.000Z`); // @db.Date columns are UTC midnight
export const attendanceDto = (a) => ({
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
//# sourceMappingURL=attendance.mapper.js.map