import { prisma } from "../../lib/prisma.js";
import { requireAdmin } from "../../lib/projectAccess.js";
import { spendByProject } from "../projects/spend.service.js";
import { percentChange, periodWindows, portfolio, projectRow, spendTrend, sumIn, trendBuckets, } from "./dashboard.calc.js";
const num = (d) => (d === null || d === undefined ? 0 : typeof d === "number" ? d : d.toNumber());
/**
 * Everything the admin dashboard shows, in one request. Admins only: it covers every project and every person.
 * `period` picks the window for the "this week / month / quarter" figures and the trend's bucket size.
 */
export async function adminOverview(userId, period) {
    await requireAdmin(userId);
    const now = new Date();
    const { current, previous } = periodWindows(period, now);
    const buckets = trendBuckets(period, now);
    const since = new Date(Math.min(buckets[0].from.getTime(), previous.from.getTime()));
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
    const [projects, receipts, attendance, pending, waiting, alerts, sharesNow, sharesBefore, boqs, activity, proofs] = await Promise.all([
        prisma.project.findMany({
            where: { status: "ONGOING" },
            select: { id: true, title: true, projectCost: true, tasks: { select: { work: true, stipulated: true, paid: true, progress: true, startDate: true, endDate: true } } },
            orderBy: { updatedAt: "desc" },
            take: 50,
        }),
        // Material that arrived (Materials › Delivery log), at what it cost; deliveries still waiting for a rate count later
        prisma.materialDelivery.findMany({ where: { date: { gte: since }, ratePending: false, archivedAt: null, purchase: { archivedAt: null } }, select: { date: true, amount: true } }),
        // Labour paid day by day (attendance entries)
        prisma.attendance.findMany({ where: { date: { gte: since }, archivedAt: null }, select: { date: true, totalAmount: true } }),
        // Team days from the site diary the manager hasn't added to attendance yet (last 30 days)
        prisma.siteReportTeam.findMany({
            where: { present: true, attendanceId: null, report: { date: { gte: monthAgo }, project: { status: "ONGOING" } } },
            select: { report: { select: { submittedAt: true, project: { select: { id: true, title: true } } } } },
            orderBy: { report: { submittedAt: "asc" } },
        }),
        // New sign-ups nobody has given access yet
        prisma.user.findMany({ where: { role: "USER", permissions: { isEmpty: true } }, select: { email: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
        // Material that arrived (site diary) with no rate yet: it doesn't count as spending until priced
        prisma.materialDelivery.findMany({ where: { ratePending: true, archivedAt: null, purchase: { archivedAt: null } }, select: { createdAt: true, projectId: true }, orderBy: { createdAt: "asc" } }),
        prisma.drawingShare.findMany({ where: { createdAt: { gte: current.from } }, select: { userId: true } }),
        prisma.drawingShare.count({ where: { createdAt: { gte: previous.from, lt: previous.to } } }),
        prisma.boq.groupBy({ by: ["status"], _count: { _all: true }, _sum: { grandTotal: true } }),
        prisma.auditLog.findMany({
            orderBy: { createdAt: "desc" },
            take: 6,
            select: { id: true, actorEmail: true, summary: true, action: true, createdAt: true, project: { select: { title: true } } },
        }),
        // Payments clients sent that nobody has checked yet
        prisma.paymentProof.findMany({ where: { status: "PENDING" }, select: { amount: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    ]);
    /* ------------------------------ projects ------------------------------ */
    const spend = await spendByProject(projects.map((p) => p.id));
    const inputs = projects.map((p) => ({
        id: p.id,
        title: p.title,
        projectCost: p.projectCost === null ? null : num(p.projectCost),
        materialSpent: spend.get(p.id)?.material.deliveries ?? 0,
        materialExpected: spend.get(p.id)?.material.planned ?? 0,
        tasks: p.tasks.map((t) => ({ work: t.work, stipulated: num(t.stipulated), paid: num(t.paid), progress: t.progress, startDate: t.startDate, endDate: t.endDate })),
    }));
    const rows = inputs.map((p) => projectRow(p, now));
    const all = portfolio(inputs, rows);
    /* -------------------------------- money -------------------------------- */
    const materialRows = receipts.map((r) => ({ at: r.date, amount: num(r.amount) }));
    const labourRows = attendance.map((a) => ({ at: a.date, amount: num(a.totalAmount) }));
    const countIn = (w) => attendance.filter((a) => a.date >= w.from && a.date < w.to).length;
    const materialNow = sumIn(materialRows, current);
    const materialBefore = sumIn(materialRows, previous);
    const entriesNow = countIn(current);
    const entriesBefore = countIn(previous);
    const titleOf = new Map(projects.map((p) => [p.id, p.title]));
    const boqCount = (status) => boqs.find((b) => b.status === status)?._count._all ?? 0;
    /* ------------------------------ needs you ------------------------------ */
    const needs = [];
    if (proofs.length) {
        needs.push({
            kind: "payments",
            title: `${proofs.length} client ${proofs.length === 1 ? "payment" : "payments"} to check`,
            detail: `₹${Math.round(proofs.reduce((s, p) => s + num(p.amount), 0)).toLocaleString("en-IN")} sent with screenshots`,
            href: "/dashboard/clients",
            since: proofs[0].createdAt.toISOString(),
        });
    }
    if (pending.length) {
        const oldest = pending[0].report;
        needs.push({
            kind: "requests",
            title: `${pending.length} team ${pending.length === 1 ? "day" : "days"} from the site diary to add to attendance`,
            detail: `Oldest from ${oldest.project.title}`,
            href: `/dashboard?p=${oldest.project.id}&s=diary`,
            since: oldest.submittedAt.toISOString(),
        });
    }
    if (waiting.length) {
        needs.push({
            kind: "access",
            title: `${waiting.length} ${waiting.length === 1 ? "person is" : "people are"} waiting for access`,
            detail: waiting.slice(0, 2).map((u) => u.email).join(", ") + (waiting.length > 2 ? ` and ${waiting.length - 2} more` : ""),
            href: "/dashboard/admin",
            since: waiting[0].createdAt.toISOString(),
        });
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
    if (alerts.length) {
        const first = alerts[0];
        needs.push({
            kind: "rates",
            title: `${alerts.length} ${alerts.length === 1 ? "delivery needs" : "deliveries need"} a rate`,
            detail: `Material that arrived, logged in the site diary${titleOf.get(first.projectId) ? `: ${titleOf.get(first.projectId)}` : ""}`,
            href: `/dashboard?p=${first.projectId}&s=diary`,
            since: first.createdAt.toISOString(),
        });
    }
    return {
        period,
        generatedAt: now.toISOString(),
        kpis: {
            budget: { spent: all.spent, budget: all.budget, projectsWithoutBudget: rows.filter((r) => r.budget === null).length },
            work: { done: all.done, time: all.time, late: rows.filter((r) => r.status === "Running late").map((r) => r.title) },
            labour: { paid: all.labourPaid, earned: all.earned, due: all.labourDue },
            // requests: team days to add to attendance; lateDeliveries: deliveries waiting for a rate (names kept for the page)
            approvals: { requests: pending.length, people: waiting.length, lateDeliveries: alerts.length, payments: proofs.length, oldest: pending[0]?.report.submittedAt.toISOString() ?? null },
        },
        strip: {
            materialSpend: { current: materialNow, previous: materialBefore, change: percentChange(materialNow, materialBefore) },
            attendance: { current: entriesNow, previous: entriesBefore, change: entriesNow - entriesBefore },
            alerts: { open: alerts.length, late: 0 }, // deliveries waiting for a rate
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
//# sourceMappingURL=dashboard.service.js.map