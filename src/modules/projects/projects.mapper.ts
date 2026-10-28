import type { Project, Task } from "../../generated/prisma/client.js";
import type { TaskBody } from "./projects.schema.js";

type ProjectWithTasks = Project & { tasks: Task[] };

const day = (d: Date) => d.toISOString().slice(0, 10);
export const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`); // @db.Date columns are UTC midnight

/** Request body -> Prisma columns */
export const taskData = (t: TaskBody, position: number) => ({
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
export const taskDto = (t: Task) => ({
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

export const projectDto = (p: ProjectWithTasks) => ({
  id: p.id,
  title: p.title,
  projectCost: p.projectCost?.toNumber() ?? null,
  status: p.status,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  tasks: p.tasks.map(taskDto),
});

/** Lightweight shape for the project cards */
/** Material totals for one project (from materialTotalsByProject); none yet means zero */
export interface MaterialTotals {
  spent: number;
  expected: number;
}

export function summaryDto(p: ProjectWithTasks & { _count?: { attendance: number } }, materials: MaterialTotals = { spent: 0, expected: 0 }) {
  const tasks = p.tasks.map(taskDto);
  const budget = tasks.reduce((s, t) => s + t.stipulated, 0);
  const paid = tasks.reduce((s, t) => s + t.paid, 0);
  const progress =
    budget > 0
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
    endDate: ends.length > 0 ? ends[ends.length - 1]! : null,
    updatedAt: p.updatedAt,
  };
}
