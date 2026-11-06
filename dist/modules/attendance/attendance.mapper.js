const day = (d) => d.toISOString().slice(0, 10);
export const toDate = (s) => new Date(`${s}T00:00:00.000Z`); // @db.Date columns are UTC midnight
export const attendanceDto = (a) => ({
    id: a.id,
    projectId: a.projectId,
    project: a.project,
    contractorName: a.contractorName,
    trade: a.trade,
    date: day(a.date),
    workers: a.workers.map((w) => ({
        id: w.id,
        label: w.label,
        amount: w.amount.toNumber(),
        // Paid hourly: who (team list), hours and OT that day, and the rate used; all null when paid by amount
        memberId: w.memberId ?? null,
        hours: w.hours === null ? null : w.hours.toNumber(),
        otHours: w.otHours === null ? null : w.otHours.toNumber(),
        hourlyRate: w.hourlyRate === null ? null : w.hourlyRate.toNumber(),
    })),
    payMode: a.payMode === "hourly" ? "hourly" : "amount",
    extras: a.extras.toNumber(),
    notes: a.notes,
    totalAmount: a.totalAmount.toNumber(),
    batchId: a.batchId ?? null, // set when several days were saved together
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
});
//# sourceMappingURL=attendance.mapper.js.map