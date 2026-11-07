import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { deleteDrawingFile, drawingUrls, uploadDrawingFile } from "../../lib/cloudinary.js";
import { detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { recordAudit } from "../audit/audit.service.js";
import { canonicalTrade, DEFAULT_TRADES } from "../attendance/attendance.trades.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { canonicalName, contractorLedger, tradeCosts } from "./contractor-payments.calc.js";
/*
 * Money paid to labour contractors, and the labour page's figures.
 * Seeing them needs "View attendance"; adding or deleting a payment needs "Create and edit projects".
 */
const ymd = (d) => d.toISOString().slice(0, 10);
const kindOf = (format) => (format === "pdf" ? "pdf" : "image");
const num = (d) => d?.toNumber() ?? 0;
const select = {
    id: true,
    trade: true,
    contractorName: true,
    date: true,
    amount: true,
    remark: true,
    proofId: true,
    proofVersion: true,
    proofFormat: true,
    createdAt: true,
    addedBy: { select: { name: true, email: true } },
};
const dto = (p) => ({
    id: p.id,
    trade: p.trade,
    contractorName: p.contractorName,
    date: ymd(p.date),
    amount: p.amount.toNumber(),
    remark: p.remark,
    // A private signed link to open the receipt (photo or PDF); none when nothing was attached
    proofUrl: p.proofId && p.proofVersion !== null && p.proofFormat
        ? drawingUrls({ publicId: p.proofId, version: p.proofVersion, format: p.proofFormat, kind: kindOf(p.proofFormat) }).openUrl
        : null,
    proofKind: p.proofFormat ? kindOf(p.proofFormat) : null,
    addedBy: p.addedBy.name || p.addedBy.email,
    createdAt: p.createdAt,
});
/** What each contractor earned on this project, by trade: attendance, plus contract work measured (area × rate) */
const earnedRows = async (projectId) => {
    const [attendance, contract] = await Promise.all([
        prisma.attendance.groupBy({ by: ["trade", "contractorName"], where: { projectId }, _sum: { totalAmount: true } }),
        prisma.labourMeasure.groupBy({ by: ["trade", "contractorName"], where: { projectId }, _sum: { amount: true } }),
    ]);
    return [
        ...attendance.map((g) => ({ trade: g.trade, contractorName: g.contractorName, total: num(g._sum.totalAmount) })),
        ...contract.map((g) => ({ trade: g.trade, contractorName: g.contractorName, total: num(g._sum.amount) })),
    ];
};
/** GET /projects/:id/contractor-payments: every payment (newest first), each contractor's ledger, and the totals */
export async function listPayments(userId, projectId) {
    await requirePermission(userId, projectId, "attendance.view");
    const [rows, earned, paid] = await Promise.all([
        prisma.contractorPayment.findMany({ where: { projectId }, select, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
        earnedRows(projectId),
        prisma.contractorPayment.groupBy({ by: ["trade", "contractorName"], where: { projectId }, _sum: { amount: true }, _max: { date: true } }),
    ]);
    const contractors = contractorLedger(earned, paid.map((g) => ({ trade: g.trade, contractorName: g.contractorName, total: num(g._sum.amount) })), paid.flatMap((g) => (g._max.date ? [{ trade: g.trade, contractorName: g.contractorName, total: 0, date: ymd(g._max.date) }] : [])));
    const sum = (pick) => Math.round(contractors.reduce((s, c) => s + pick(c), 0) * 100) / 100;
    const usedTrades = [...new Set(contractors.map((c) => c.trade).filter(Boolean))];
    return {
        items: rows.map(dto),
        contractors,
        totals: { earned: sum((c) => c.earned), paid: sum((c) => c.paid), balance: sum((c) => c.balance) },
        // Trades to offer on the form: the ones used here first, then the usual ones
        trades: [...usedTrades, ...DEFAULT_TRADES.filter((d) => !usedTrades.some((u) => u.toLowerCase() === d.toLowerCase()))],
    };
}
/**
 * GET /projects/:id/labour-summary: the labour page's donut. Labour cost by trade (from attendance) and the General
 * expenditure, plus what has been paid to contractors so far.
 */
export async function labourSummary(userId, projectId) {
    await requirePermission(userId, projectId, "attendance.view");
    const [earned, paid, general] = await Promise.all([
        earnedRows(projectId),
        prisma.contractorPayment.aggregate({ where: { projectId }, _sum: { amount: true } }),
        prisma.expense.aggregate({ where: { projectId, category: "general" }, _sum: { amount: true } }),
    ]);
    const trades = tradeCosts(earned);
    const labour = Math.round(trades.reduce((s, t) => s + t.cost, 0) * 100) / 100;
    const generalExpenses = num(general._sum.amount);
    const paidOut = num(paid._sum.amount);
    return {
        trades,
        labour, // all trades together
        generalExpenses,
        total: Math.round((labour + generalExpenses) * 100) / 100,
        paid: paidOut,
        toPay: Math.round((labour - paidOut) * 100) / 100, // below 0: paid in advance
    };
}
/** POST /projects/:id/contractor-payments: one payment, with an optional receipt (photo or PDF) */
export async function addPayment(userId, projectId, input, file) {
    await requirePermission(userId, projectId, "project.manage");
    if (input.date > dayKeyIn(new Date()))
        throw new HttpError(400, "The date can't be in the future.");
    // Same spelling as attendance and earlier payments, so the ledger lines up
    const [attendanceNames, paymentNames] = await Promise.all([
        prisma.attendance.findMany({ where: { projectId }, distinct: ["trade", "contractorName"], select: { trade: true, contractorName: true } }),
        prisma.contractorPayment.findMany({ where: { projectId }, distinct: ["trade", "contractorName"], select: { trade: true, contractorName: true } }),
    ]);
    const known = [...attendanceNames, ...paymentNames];
    const trade = input.trade ? canonicalTrade(input.trade, [...known.map((k) => k.trade).filter(Boolean), ...DEFAULT_TRADES]) : "";
    const contractorName = canonicalName(input.contractorName, known.map((k) => k.contractorName));
    let proof = null;
    if (file) {
        const detected = detectFileType(file.buffer);
        if (!detected || detected.kind === "cad")
            throw new HttpError(415, "Attach a photo (JPG, PNG, WebP) or a PDF.");
        if (detected.kind === "image" && file.size > MAX_IMAGE_BYTES)
            throw new HttpError(413, "Photos can be up to 10 MB.");
        const stored = await uploadDrawingFile(file.buffer, detected);
        proof = { proofId: stored.publicId, proofVersion: stored.version, proofFormat: stored.format };
    }
    try {
        const row = await prisma.$transaction(async (tx) => {
            const created = await tx.contractorPayment.create({
                data: {
                    projectId,
                    trade,
                    contractorName,
                    date: new Date(`${input.date}T00:00:00Z`),
                    amount: input.amount,
                    remark: input.remark,
                    addedById: userId,
                    ...proof,
                },
                select,
            });
            await recordAudit(tx, {
                projectId,
                actorId: userId,
                action: "contractor_payment.added",
                entityType: "project",
                entityId: created.id,
                summary: `Paid ${input.amount} to ${contractorName}${trade ? ` (${trade})` : ""} on ${input.date}`,
            });
            return created;
        });
        return { payment: dto(row) };
    }
    catch (err) {
        if (proof)
            await deleteDrawingFile(proof.proofId, kindOf(proof.proofFormat)); // never leave an orphan file behind
        throw err;
    }
}
/** DELETE /projects/:id/contractor-payments/:paymentId */
export async function removePayment(userId, projectId, paymentId) {
    await requirePermission(userId, projectId, "project.manage");
    const before = await prisma.contractorPayment.findFirst({ where: { id: paymentId, projectId } });
    if (!before)
        throw new HttpError(404, "Payment not found");
    await prisma.$transaction(async (tx) => {
        await tx.contractorPayment.delete({ where: { id: paymentId } });
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "contractor_payment.deleted",
            entityType: "project",
            entityId: paymentId,
            summary: `Deleted payment of ${before.amount.toNumber()} to ${before.contractorName} on ${ymd(before.date)}`,
        });
    });
    if (before.proofId && before.proofFormat)
        await deleteDrawingFile(before.proofId, kindOf(before.proofFormat));
    return { ok: true };
}
//# sourceMappingURL=contractor-payments.service.js.map