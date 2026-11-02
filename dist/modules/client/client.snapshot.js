import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { drawingUrls } from "../../lib/cloudinary.js";
import { getUserAccess } from "../../lib/projectAccess.js";
import { advanceStatus, instalmentState, invoiceNo, paymentSummary, scheduleSummary, } from "./client.calc.js";
export const num = (d) => (d === null || d === undefined ? 0 : typeof d === "number" ? d : d.toNumber());
export const dayKey = (d) => (d ? d.toISOString().slice(0, 10) : null);
/* ----------------------------------- access ----------------------------------- */
/** A client may open a project only if the admin linked them to it */
export async function requireClientOf(userId, projectId) {
    const link = await prisma.projectClient.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { projectId: true } });
    if (!link)
        throw new HttpError(404, "Project not found");
}
/** Invoices and payment files: the linked client, or an admin */
export async function requireClientOrAdmin(userId, projectId) {
    const access = await getUserAccess(userId);
    if (access.isAdmin)
        return { isAdmin: true };
    await requireClientOf(userId, projectId);
    return { isAdmin: false };
}
/* ---------------------------------- proofs ---------------------------------- */
const proofSelect = {
    id: true, instalmentId: true, amount: true, paidOn: true, mode: true, reference: true, note: true,
    publicId: true, version: true, format: true, bytes: true, status: true, decisionNote: true, decidedAt: true, createdAt: true,
    uploadedBy: { select: { email: true, name: true, role: true } },
    decidedBy: { select: { email: true, name: true } },
};
const nameOf = (u) => u.name?.trim() || u.email;
/** A payment, with signed links to its screenshot or PDF (made here, no call to Cloudinary) */
export function proofDto(p) {
    const file = p.publicId && p.version !== null && p.format
        ? drawingUrls({ publicId: p.publicId, version: p.version, format: p.format, kind: p.format === "pdf" ? "pdf" : "image" })
        : null;
    return {
        id: p.id,
        instalmentId: p.instalmentId,
        amount: num(p.amount),
        paidOn: dayKey(p.paidOn),
        mode: p.mode,
        reference: p.reference,
        note: p.note,
        status: p.status,
        decisionNote: p.decisionNote,
        decidedAt: p.decidedAt?.toISOString() ?? null,
        decidedBy: p.decidedBy ? nameOf(p.decidedBy) : null,
        uploadedBy: nameOf(p.uploadedBy),
        byClient: p.uploadedBy.role === "CLIENT",
        createdAt: p.createdAt.toISOString(),
        file: file && { thumbnailUrl: file.thumbnailUrl, openUrl: file.openUrl, isPdf: p.format === "pdf" },
    };
}
export { proofSelect };
/* --------------------------------- snapshot --------------------------------- */
/**
 * Everything about a project's work and money that the client portal and the admin's client page show:
 * work status, the payment schedule with each payment's state, payments made, and delays.
 */
export async function projectSnapshot(db, projectId, now = new Date()) {
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: {
            id: true, title: true, status: true, projectCost: true, advanceOverride: true, createdAt: true,
            tasks: { select: { id: true, work: true, area: true, stipulated: true, progress: true, startDate: true, endDate: true }, orderBy: { position: "asc" } },
            instalments: { orderBy: { number: "asc" }, include: { proofs: { select: proofSelect, orderBy: { createdAt: "desc" } } } },
            delays: { orderBy: { fromDate: "desc" }, include: { createdBy: { select: { email: true, name: true } } } },
        },
    });
    if (!project)
        throw new HttpError(404, "Project not found");
    const tasks = project.tasks.map((t) => ({ ...t, stipulated: num(t.stipulated) }));
    const schedule = scheduleSummary(tasks, now);
    const instalments = project.instalments.map((i) => {
        const state = instalmentState({
            id: i.id,
            kind: i.kind,
            amount: num(i.amount),
            taxPercent: num(i.taxPercent),
            dueDate: i.dueDate,
            dueAtProgress: i.dueAtProgress,
            requestedAt: i.requestedAt,
            createdAt: i.createdAt,
            proofs: i.proofs.map((p) => ({ amount: num(p.amount), status: p.status })),
        }, schedule.done, now);
        return {
            id: i.id,
            number: i.number,
            invoiceNo: invoiceNo(i.number),
            label: i.label,
            kind: i.kind,
            amount: num(i.amount),
            taxPercent: num(i.taxPercent),
            dueDate: dayKey(i.dueDate),
            dueAtProgress: i.dueAtProgress,
            requestedAt: i.requestedAt?.toISOString() ?? null,
            note: i.note,
            ...state,
            proofs: i.proofs.map(proofDto),
        };
    });
    const works = tasks.map((t) => {
        const late = t.progress < 100 && t.endDate.getTime() < now.getTime() - 86_400_000;
        return {
            id: t.id,
            work: t.work,
            area: t.area,
            progress: t.progress,
            startDate: dayKey(t.startDate),
            endDate: dayKey(t.endDate),
            status: t.progress >= 100 ? "Done" : late ? "Late" : t.progress > 0 ? "In progress" : t.startDate.getTime() > now.getTime() ? "Not started" : "Starting",
        };
    });
    return {
        project: { id: project.id, title: project.title, status: project.status, projectCost: project.projectCost === null ? null : num(project.projectCost) },
        schedule,
        works,
        instalments,
        payments: paymentSummary(instalments),
        advance: advanceStatus(instalments, project.advanceOverride),
        advanceOverride: project.advanceOverride,
        delays: project.delays.map((d) => ({
            id: d.id,
            reason: d.reason,
            title: d.title,
            note: d.note,
            fromDate: dayKey(d.fromDate),
            days: d.days,
            tasksMoved: d.tasksMoved,
            paymentsMoved: d.paymentsMoved,
            by: nameOf(d.createdBy),
            createdAt: d.createdAt.toISOString(),
        })),
        delayDays: project.delays.reduce((s, d) => s + d.days, 0),
    };
}
//# sourceMappingURL=client.snapshot.js.map