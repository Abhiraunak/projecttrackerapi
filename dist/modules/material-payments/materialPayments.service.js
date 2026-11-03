import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { deleteDrawingFile, drawingUrls, uploadDrawingFile } from "../../lib/cloudinary.js";
import { detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { recordAudit } from "../audit/audit.service.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { canonicalVendor, vendorLedger } from "./materialPayments.calc.js";
/*
 * Money paid to material vendors, like Payments on the Labour page. Seeing it needs "View materials"; adding or
 * deleting a payment needs "Create and edit projects" (money), the same as labour payments.
 */
const ymd = (d) => d.toISOString().slice(0, 10);
const kindOf = (format) => (format === "pdf" ? "pdf" : "image");
const num = (d) => d?.toNumber() ?? 0;
const select = {
    id: true,
    vendorName: true,
    date: true,
    amount: true,
    remark: true,
    proofId: true,
    proofVersion: true,
    proofFormat: true,
    createdAt: true,
    material: { select: { id: true, name: true, unit: true } },
    addedBy: { select: { name: true, email: true } },
};
const dto = (p) => ({
    id: p.id,
    vendorName: p.vendorName,
    material: p.material,
    date: ymd(p.date),
    amount: p.amount.toNumber(),
    remark: p.remark,
    proofUrl: p.proofId && p.proofVersion !== null && p.proofFormat
        ? drawingUrls({ publicId: p.proofId, version: p.proofVersion, format: p.proofFormat, kind: kindOf(p.proofFormat) }).openUrl
        : null,
    proofKind: p.proofFormat ? kindOf(p.proofFormat) : null,
    addedBy: p.addedBy.name || p.addedBy.email,
    createdAt: p.createdAt,
});
/** What each vendor delivered on this project, valued: orders at their own rate, other deliveries at the standard rate */
async function boughtFrom(projectId) {
    const [orders, loose] = await Promise.all([
        prisma.materialOrder.findMany({ where: { projectId, vendorId: { not: null } }, select: { receivedQty: true, rate: true, vendor: { select: { name: true } } } }),
        prisma.stockMovement.findMany({ where: { projectId, type: "RECEIVED", orderId: null, vendorName: { not: "" } }, select: { vendorName: true, quantity: true, material: { select: { rate: true } } } }),
    ]);
    return [
        ...orders.map((o) => ({ vendorName: o.vendor?.name ?? "", total: num(o.receivedQty) * num(o.rate) })),
        ...loose.map((m) => ({ vendorName: m.vendorName, total: num(m.quantity) * num(m.material.rate) })),
    ];
}
/** Every vendor name this project or the company already uses, so a payment lines up with deliveries */
async function knownVendors(projectId) {
    const [catalog, moved, paid] = await Promise.all([
        prisma.vendor.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
        prisma.stockMovement.findMany({ where: { projectId, vendorName: { not: "" } }, distinct: ["vendorName"], select: { vendorName: true } }),
        prisma.materialPayment.findMany({ where: { projectId }, distinct: ["vendorName"], select: { vendorName: true } }),
    ]);
    return [...new Set([...paid.map((p) => p.vendorName), ...moved.map((m) => m.vendorName), ...catalog.map((v) => v.name)])];
}
/** GET /projects/:projectId/material-payments: every payment (newest first), each vendor's ledger, the totals */
export async function listMaterialPayments(userId, projectId) {
    await requirePermission(userId, projectId, "materials.view");
    const [rows, bought, vendors] = await Promise.all([
        prisma.materialPayment.findMany({ where: { projectId }, select, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
        boughtFrom(projectId),
        knownVendors(projectId),
    ]);
    const items = rows.map(dto);
    const ledger = vendorLedger(bought, items.map((p) => ({ vendorName: p.vendorName, total: p.amount, date: p.date })));
    const sum = (pick) => Math.round(ledger.reduce((s, l) => s + pick(l), 0) * 100) / 100;
    return {
        items,
        vendors: ledger,
        totals: { bought: sum((l) => l.bought), paid: sum((l) => l.paid), balance: sum((l) => Math.max(l.balance, 0)) },
        vendorNames: vendors,
    };
}
/** POST /projects/:projectId/material-payments: one payment, with an optional receipt (photo or PDF) */
export async function addMaterialPayment(userId, projectId, input, file) {
    await requirePermission(userId, projectId, "project.manage");
    if (input.date > dayKeyIn(new Date()))
        throw new HttpError(400, "The date can't be in the future.");
    const vendorName = canonicalVendor(input.vendorName, await knownVendors(projectId));
    if (input.materialId && !(await prisma.material.findUnique({ where: { id: input.materialId }, select: { id: true } })))
        throw new HttpError(404, "That material is no longer on the list.");
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
            const created = await tx.materialPayment.create({
                data: { projectId, vendorName, materialId: input.materialId ?? null, date: new Date(`${input.date}T00:00:00Z`), amount: input.amount, remark: input.remark, addedById: userId, ...proof },
                select,
            });
            await recordAudit(tx, {
                projectId,
                actorId: userId,
                action: "material_payment.added",
                entityType: "project",
                entityId: created.id,
                summary: `Paid ${input.amount} to ${vendorName}${created.material ? ` for ${created.material.name}` : ""} on ${input.date}`,
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
/** DELETE /projects/:projectId/material-payments/:paymentId */
export async function removeMaterialPayment(userId, projectId, paymentId) {
    await requirePermission(userId, projectId, "project.manage");
    const before = await prisma.materialPayment.findFirst({ where: { id: paymentId, projectId } });
    if (!before)
        throw new HttpError(404, "Payment not found");
    await prisma.$transaction(async (tx) => {
        await tx.materialPayment.delete({ where: { id: paymentId } });
        await recordAudit(tx, {
            projectId,
            actorId: userId,
            action: "material_payment.deleted",
            entityType: "project",
            entityId: paymentId,
            summary: `Deleted payment of ${before.amount.toNumber()} to ${before.vendorName} on ${ymd(before.date)}`,
        });
    });
    if (before.proofId && before.proofFormat)
        await deleteDrawingFile(before.proofId, kindOf(before.proofFormat));
    return { ok: true };
}
//# sourceMappingURL=materialPayments.service.js.map