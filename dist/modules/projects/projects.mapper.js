const day = (d) => d.toISOString().slice(0, 10);
export const toDate = (s) => new Date(`${s}T00:00:00.000Z`); // @db.Date columns are UTC midnight
/** Request body -> Prisma columns */
export const taskData = (t, position) => ({
    work: t.work,
    area: t.area,
    contractorRate: t.contractorRate,
    inHouseRate: t.inHouseRate,
    stipulated: t.stipulated,
    paid: t.paid,
    progress: t.progress,
    startDate: toDate(t.startDate),
    endDate: toDate(t.endDate),
    position,
});
/** Prisma row -> JSON the frontend expects (Decimal becomes number, dates become YYYY-MM-DD) */
export const taskDto = (t) => ({
    id: t.id,
    work: t.work,
    area: t.area,
    contractorRate: t.contractorRate,
    inHouseRate: t.inHouseRate,
    stipulated: t.stipulated.toNumber(),
    paid: t.paid.toNumber(),
    progress: t.progress,
    startDate: day(t.startDate),
    endDate: day(t.endDate),
});
export const projectDto = (p) => ({
    id: p.id,
    title: p.title,
    projectCost: p.projectCost?.toNumber() ?? null,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    tasks: p.tasks.map(taskDto),
});
export function summaryDto(p, materials = { spent: 0, expected: 0 }) {
    const tasks = p.tasks.map(taskDto);
    const budget = tasks.reduce((s, t) => s + t.stipulated, 0);
    const paid = tasks.reduce((s, t) => s + t.paid, 0);
    const progress = budget > 0
        ? tasks.reduce((s, t) => s + t.stipulated * t.progress, 0) / budget
        : tasks.length
            ? tasks.reduce((s, t) => s + t.progress, 0) / tasks.length
            : 0;
    const starts = tasks.map((t) => t.startDate).sort();
    const ends = tasks.map((t) => t.endDate).sort();
    return {
        id: p.id,
        title: p.title,
        projectCost: p.projectCost?.toNumber() ?? null,
        spent: Math.round((paid + materials.spent) * 100) / 100, // labour paid + materials received, so a card can show what is left
        labourPaid: paid,
        materialSpent: materials.spent,
        materialExpected: materials.expected,
        status: p.status,
        taskCount: tasks.length,
        attendanceCount: p._count?.attendance ?? 0,
        budget,
        paid,
        progress: Math.round(progress),
        startDate: starts[0] ?? null,
        endDate: ends.length > 0 ? ends[ends.length - 1] : null,
        updatedAt: p.updatedAt,
    };
}
//# sourceMappingURL=projects.mapper.js.map