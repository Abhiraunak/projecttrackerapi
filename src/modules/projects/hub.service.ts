import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan } from "../../lib/projectAccess.js";
import type { Permission } from "../../lib/permissions.js";
import { isOn } from "../../lib/features.js";
import { logger } from "../../config/logger.js";
import { materialTotalsByProject } from "../inventory/cost.service.js";
import { equipmentHeadline } from "../equipment/equipment.service.js";
import { dayKeyIn, dayRange } from "../punches/punch.calc.js";
import { taskDto } from "./projects.mapper.js";
import { labourFigures, moneyFigures, overallProgress, scheduleFigures } from "./hub.calc.js";

const num = (v: { toNumber(): number } | null | undefined) => v?.toNumber() ?? 0;
const DAY = 86_400_000;

/**
 * One tile's figures. If that part fails (for example its table isn't in the database yet), the hub still opens
 * with the other tiles, that tile stays empty, and the log says exactly which part failed and why.
 */
function part<T>(name: string, projectId: string, run: () => Promise<T>): Promise<T | null> {
  return run().catch((err: unknown) => {
    logger.error({ err, projectId, part: name }, `project hub: the ${name} figures failed`);
    return null;
  });
}

/**
 * Everything the project hub shows, in one request, so the hub opens with a single round trip.
 * Each section's figures are only read (and sent) when the person may open that section; the others come back null.
 */
export async function projectHub(userId: string, projectId: string) {
  const access = await requireCan(userId, "project.view");
  const can = (p: Permission) => access.permissions.includes(p);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, title: true, firmName: true, status: true, projectCost: true, updatedAt: true, tasks: { orderBy: { position: "asc" } } },
  });
  if (!project) throw new HttpError(404, "Project not found");

  const today = dayKeyIn(new Date());
  const weekFrom = dayRange(new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY).toISOString().slice(0, 10)).from;

  const [materials, openAlerts, pendingRequests, boqs, drawingCount, lastAttendance, weekAttendance, equipment] = await Promise.all([
    part("materials", projectId, () => materialTotalsByProject([projectId]).then((m) => m.get(projectId) ?? { spent: 0, expected: 0 })),
    can("materials.view") ? part("stock alerts", projectId, () => prisma.stockAlert.count({ where: { projectId, resolvedAt: null } })) : null,
    can("materials.view") ? part("material requests", projectId, () => prisma.materialRequest.count({ where: { projectId, status: "PENDING" } })) : null,
    can("boq.use")
      ? part("BOQ", projectId, () =>
          prisma.boq.findMany({
            where: { projectId },
            select: { id: true, title: true, boqNumber: true, status: true, grandTotal: true, itemCount: true, updatedAt: true },
            orderBy: { updatedAt: "desc" },
            take: 20,
          })
        )
      : null,
    // With Phase 4 on: this project's drawings (latest revision of each number). Before: the ones this person can see.
    can("drawings.use")
      ? part("drawings", projectId, () =>
          prisma.drawing.count({ where: isOn("drawingsByProject") ? { projectId, current: true } : { current: true, OR: [{ ownerId: userId }, { shares: { some: { userId } } }] } })
        )
      : null,
    can("attendance.view")
      ? part("last attendance", projectId, () =>
          prisma.attendance.findFirst({ where: { projectId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: { date: true, totalAmount: true } })
        )
      : null,
    can("attendance.view")
      ? part("attendance this week", projectId, () =>
          prisma.attendance.aggregate({ where: { projectId, date: { gte: weekFrom } }, _sum: { totalAmount: true }, _count: true })
        )
      : null,
    // Phase 6: items at this site and this month's hire
    isOn("equipment") && can("equipment.view") ? part("equipment", projectId, () => equipmentHeadline(projectId)) : null,
  ]);

  const tasks = project.tasks.map(taskDto);
  const labour = labourFigures(tasks);

  return {
    project: {
      id: project.id,
      title: project.title,
      firmName: project.firmName,
      status: project.status,
      updatedAt: project.updatedAt,
    },
    progress: { percent: overallProgress(tasks), items: tasks.length, ...scheduleFigures(tasks, today) },
    money: moneyFigures(project.projectCost?.toNumber() ?? null, labour.agreed, labour.paid, materials?.spent ?? 0),
    labour,
    // Contractor vs in-house for the work items that have both rates
    // rates: rateFigures(tasks),
    materials: can("materials.view") && materials ? { spent: materials.spent, expected: materials.expected, openAlerts: openAlerts ?? 0, pendingRequests: pendingRequests ?? 0 } : null,
    boqs: boqs
      ? boqs.map((b) => ({ id: b.id, title: b.title, boqNumber: b.boqNumber, status: b.status, grandTotal: num(b.grandTotal), itemCount: b.itemCount, updatedAt: b.updatedAt }))
      : null,
    drawings: drawingCount === null ? null : { count: drawingCount },
    attendance: weekAttendance
      ? {
          entriesThisWeek: weekAttendance._count,
          amountThisWeek: num(weekAttendance._sum.totalAmount),
          lastDate: lastAttendance ? lastAttendance.date.toISOString().slice(0, 10) : null,
          lastAmount: lastAttendance ? num(lastAttendance.totalAmount) : null,
        }
      : null,
    equipment,
  };
}

export type ProjectHub = Awaited<ReturnType<typeof projectHub>>;