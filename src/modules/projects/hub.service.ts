import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan } from "../../lib/projectAccess.js";
import type { Permission } from "../../lib/permissions.js";
import { logger } from "../../config/logger.js";
import { spendByProject } from "./spend.service.js";
import { equipmentHeadline } from "../equipment/equipment.service.js";
import { dayKeyIn, dayRange } from "../punches/punch.calc.js";
import { numberOf, taskDto } from "./projects.mapper.js";
import { labourFigures, moneyFigures, overallProgress, rateFigures, scheduleFigures } from "./hub.calc.js";

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
    select: { id: true, serialNo: true, number: true, title: true, firmName: true, status: true, projectCost: true, startDate: true, endDate: true, updatedAt: true, tasks: { orderBy: { position: "asc" } } },
  });
  if (!project) throw new HttpError(404, "Project not found");

  const today = dayKeyIn(new Date());
  const weekFrom = dayRange(new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY).toISOString().slice(0, 10)).from;

  const [spend, boqs, drawingCount, lastAttendance, weekAttendance, equipment] = await Promise.all([
    part("spending", projectId, () => spendByProject([projectId]).then((m) => m.get(projectId)!)),
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
    // This project's drawings (the latest revision of each number)
    can("drawings.use")
      ? part("drawings", projectId, () =>
        prisma.drawing.count({ where: { projectId, current: true } })
      )
      : null,
    can("attendance.view")
      ? part("last attendance", projectId, () =>
        prisma.attendance.findFirst({ where: { projectId, archivedAt: null }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: { date: true, totalAmount: true } })
      )
      : null,
    can("attendance.view")
      ? part("attendance this week", projectId, () =>
        prisma.attendance.aggregate({ where: { projectId, archivedAt: null, date: { gte: weekFrom } }, _sum: { totalAmount: true }, _count: true })
      )
      : null,
    // Phase 6: items at this site and this month's hire
    can("equipment.view") ? part("equipment", projectId, () => equipmentHeadline(projectId)) : null,
  ]);

  const tasks = project.tasks.map(taskDto);
  const labour = labourFigures(tasks);
  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const own = { start: ymd(project.startDate), end: ymd(project.endDate) };

  return {
    project: {
      id: project.id,
      title: project.title,
      firmName: project.firmName,
      number: numberOf(project), // PT-001, or the admin's own number
      customNumber: project.number !== null,
      status: project.status,
      updatedAt: project.updatedAt,
      startDate: own.start, // set on Edit project; null = from the work items
      endDate: own.end,
    },
    progress: { percent: overallProgress(tasks), items: tasks.length, ...scheduleFigures(tasks, today, own) },
    // Spent = labour + material deliveries + equipment hire + General expenses: the same sum as GET /spend
    money: moneyFigures(project.projectCost?.toNumber() ?? null, labour.agreed, (spend?.labour.spent ?? 0) + (spend?.equipment ?? 0) + (spend?.general ?? 0), spend?.material.total ?? 0),
    labour,
    // Contractor vs in-house for the work items that have both rates
    rates: rateFigures(tasks),
    // The Materials tab's own figures: what the deliveries cost, and the preset cost of everything ordered
    materials: can("materials.view") && spend ? { spent: spend.material.deliveries, expected: spend.material.planned, openAlerts: 0, pendingRequests: 0 } : null, // the old stock alerts and requests are gone
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