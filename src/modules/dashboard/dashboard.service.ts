
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../../lib/projectAccess.js";
import { materialTotalsByProject } from "../inventory/cost.service.js";
import {
  percentChange,
  periodWindows,
  portfolio,
  projectRow,
  spendTrend,
  sumIn,
  trendBuckets,
  type DatedAmount,
  type Period,
  type ProjectInput,
} from "./dashboard.calc.js";

const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? 0 : typeof d === "number" ? d : d.toNumber());

export interface NeedItem {
  kind: "requests" | "access" | "late" | "rates" | "budget";
  title: string;
  detail: string;
  href: string;
  since: string | null; // ISO time the oldest item has been waiting since, when it matters
}

/**
 * Everything the admin dashboard shows, in one request. Admins only: it covers every project and every person.
 * `period` picks the window for the "this week / month / quarter" figures and the trend's bucket size.
 */
export async function adminOverview(userId: string, period: Period) {
  await requireAdmin(userId);
  const now = new Date();
  const { current, previous } = periodWindows(period, now);
  const buckets = trendBuckets(period, now);
  const since = new Date(Math.min(buckets[0]!.from.getTime(), previous.from.getTime()));

  const [projects, receipts, attendance, pending, waiting, alerts, sharesNow, sharesBefore, boqs, unpriced, activity] = await Promise.all([
    prisma.project.findMany({
      where: { status: "ONGOING" },
      select: { id: true, title: true, projectCost: true, tasks: { select: { work: true, stipulated: true, paid: true, progress: true, startDate: true, endDate: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    // Material received: at the order's rate, or the material's standard rate when it came without an order
    prisma.stockMovement.findMany({
      where: { type: "RECEIVED", createdAt: { gte: since } },
      select: { createdAt: true, quantity: true, order: { select: { rate: true } }, material: { select: { rate: true } } },
    }),
    // Labour paid day by day (attendance entries)
    prisma.attendance.findMany({ where: { date: { gte: since } }, select: { date: true, totalAmount: true } }),
    prisma.materialRequest.findMany({
      where: { status: "PENDING" },
      select: { createdAt: true, project: { select: { id: true, title: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // New sign-ups nobody has given access yet
    prisma.user.findMany({ where: { role: "USER", permissions: { isEmpty: true } }, select: { email: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.stockAlert.findMany({
      where: { resolvedAt: null },
      select: { kind: true, message: true, openedAt: true, project: { select: { id: true, title: true } } },
      orderBy: { openedAt: "asc" },
    }),
    prisma.drawingShare.findMany({ where: { createdAt: { gte: current.from } }, select: { userId: true } }),
    prisma.drawingShare.count({ where: { createdAt: { gte: previous.from, lt: previous.to } } }),
    prisma.boq.groupBy({ by: ["status"], _count: { _all: true }, _sum: { grandTotal: true } }),
    // Materials the plans use that have no standard rate: their budget shows ₹0
    prisma.material.count({ where: { rate: 0, itemMaterials: { some: { item: { active: true } } } } }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, actorEmail: true, summary: true, action: true, createdAt: true, project: { select: { title: true } } },
    }),
  ]);

  /* ------------------------------ projects ------------------------------ */
  const materials = await materialTotalsByProject(projects.map((p) => p.id));
  const inputs: ProjectInput[] = projects.map((p) => ({
    id: p.id,
    title: p.title,
    projectCost: p.projectCost === null ? null : num(p.projectCost),
    materialSpent: materials.get(p.id)?.spent ?? 0,
    materialExpected: materials.get(p.id)?.expected ?? 0,
    tasks: p.tasks.map((t) => ({ work: t.work, stipulated: num(t.stipulated), paid: num(t.paid), progress: t.progress, startDate: t.startDate, endDate: t.endDate })),
  }));
  const rows = inputs.map((p) => projectRow(p, now));
  const all = portfolio(inputs, rows);

  /* -------------------------------- money -------------------------------- */
  const materialRows: DatedAmount[] = receipts.map((r) => {
    const orderRate = num(r.order?.rate);
    return { at: r.createdAt, amount: num(r.quantity) * (orderRate > 0 ? orderRate : num(r.material.rate)) };
  });
  const labourRows: DatedAmount[] = attendance.map((a) => ({ at: a.date, amount: num(a.totalAmount) }));
  const countIn = (w: { from: Date; to: Date }) => attendance.filter((a) => a.date >= w.from && a.date < w.to).length;

  const materialNow = sumIn(materialRows, current);
  const materialBefore = sumIn(materialRows, previous);
  const entriesNow = countIn(current);
  const entriesBefore = countIn(previous);

  const lateAlerts = alerts.filter((a) => a.kind === "LATE_DELIVERY");
  const boqCount = (status: "DRAFT" | "FINAL") => boqs.find((b) => b.status === status)?._count._all ?? 0;

  /* ------------------------------ needs you ------------------------------ */
  const needs: NeedItem[] = [];
  if (pending.length) {
    const oldest = pending[0]!;
    needs.push({
      kind: "requests",
      title: `${pending.length} material ${pending.length === 1 ? "request" : "requests"} to approve`,
      detail: `Oldest from ${oldest.project.title}`,
      href: `/dashboard/inventory?project=${oldest.project.id}&tab=requests`,
      since: oldest.createdAt.toISOString(),
    });
  }
  if (waiting.length) {
    needs.push({
      kind: "access",
      title: `${waiting.length} ${waiting.length === 1 ? "person is" : "people are"} waiting for access`,
      detail: waiting.slice(0, 2).map((u) => u.email).join(", ") + (waiting.length > 2 ? ` and ${waiting.length - 2} more` : ""),
      href: "/dashboard/admin",
      since: waiting[0]!.createdAt.toISOString(),
    });
  }
  for (const a of lateAlerts.slice(0, 2)) {
    needs.push({ kind: "late", title: a.message, detail: a.project.title, href: `/dashboard/inventory?project=${a.project.id}&tab=orders`, since: a.openedAt.toISOString() });
  }
  for (const r of rows.filter((x) => x.status === "Over budget").slice(0, 2)) {
    needs.push({
      kind: "budget",
      title: `${r.title} is heading over budget`,
      detail: `Expected ${Math.round(r.expected).toLocaleString("en-IN")} against a budget of ${Math.round(r.budget ?? 0).toLocaleString("en-IN")}`,
      href: "/dashboard/labour",
      since: null,
    });
  }
  if (unpriced) {
    needs.push({
      kind: "rates",
      title: `${unpriced} ${unpriced === 1 ? "material has" : "materials have"} no standard rate`,
      detail: "Their part of the material budget shows ₹0",
      href: "/dashboard/inventory",
      since: null,
    });
  }

  return {
    period,
    generatedAt: now.toISOString(),
    kpis: {
      budget: { spent: all.spent, budget: all.budget, projectsWithoutBudget: rows.filter((r) => r.budget === null).length },
      work: { done: all.done, time: all.time, late: rows.filter((r) => r.status === "Running late").map((r) => r.title) },
      labour: { paid: all.labourPaid, earned: all.earned, due: all.labourDue },
      approvals: { requests: pending.length, people: waiting.length, lateDeliveries: lateAlerts.length, oldest: pending[0]?.createdAt.toISOString() ?? null },
    },
    strip: {
      materialSpend: { current: materialNow, previous: materialBefore, change: percentChange(materialNow, materialBefore) },
      attendance: { current: entriesNow, previous: entriesBefore, change: entriesNow - entriesBefore },
      alerts: { open: alerts.length, late: lateAlerts.length },
      drawings: { shares: sharesNow.length, people: new Set(sharesNow.map((s) => s.userId)).size, previous: sharesBefore },
      boqs: {
        value: boqs.reduce((s, b) => s + num(b._sum.grandTotal), 0),
        final: boqCount("FINAL"),
        draft: boqCount("DRAFT"),
      },
    },
    trend: spendTrend(buckets, materialRows, labourRows),
    projects: rows,
    needs,
    activity: activity.map((a) => ({
      id: a.id,
      who: a.actorEmail,
      summary: a.summary,
      action: a.action,
      project: a.project?.title ?? null,
      at: a.createdAt.toISOString(),
    })),
  };
}

export type AdminOverview = Awaited<ReturnType<typeof adminOverview>>;
