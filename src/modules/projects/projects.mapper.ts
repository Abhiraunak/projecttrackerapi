import type { Project, Task } from "../../generated/prisma/client.js";
import type { TaskBody } from "./projects.schema.js";
import type { ProjectSpend } from "./spend.service.js";

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
  firmName: p.firmName,
  projectCost: p.projectCost?.toNumber() ?? null,
  status: p.status,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  tasks: p.tasks.map(taskDto),
});

/** Lightweight shape for the project cards; `spend` from spendByProject (none yet means zero) */
export function summaryDto(p: ProjectWithTasks & { _count?: { attendance: number } }, spend?: ProjectSpend) {
  const tasks = p.tasks.map(taskDto);
  const budget = tasks.reduce((s, t) => s + t.stipulated, 0);
  const progress =
    budget > 0
      ? tasks.reduce((s, t) => s + t.stipulated * t.progress, 0) / budget
      : tasks.length
        ? tasks.reduce((s, t) => s + t.progress, 0) / tasks.length
        : 0;
  const starts = tasks.map((t) => t.startDate).sort();
  const ends = tasks.map((t) => t.endDate).sort();
  const total = spend?.total ?? 0;

  return {
    id: p.id,
    title: p.title,
    firmName: p.firmName,
    projectCost: p.projectCost?.toNumber() ?? null,
    // Everything spent, exactly as on the project's Overview: labour (attendance + contract work), material
    // deliveries, equipment hire and General expenses. `spent` and `totalSpent` are the same (older screens read either).
    spent: total,
    totalSpent: total,
    labourPaid: spend?.labour.paid ?? 0, // paid to contractors so far
    materialSpent: spend?.material.total ?? 0,
    materialExpected: spend?.material.planned ?? 0,
    status: p.status,
    taskCount: tasks.length,
    attendanceCount: p._count?.attendance ?? 0,
    budget,
    paid: spend?.labour.paid ?? 0,
    progress: Math.round(progress),
    startDate: starts[0] ?? null,
    endDate: ends.length > 0 ? ends[ends.length - 1]! : null,
    updatedAt: p.updatedAt,
  };
}