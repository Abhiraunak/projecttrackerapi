import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { detectFileType } from "../../lib/fileType.js";
import { deleteDrawingFile, uploadDrawingFile } from "../../lib/cloudinary.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { recordAudit } from "../audit/audit.service.js";
import { invoiceNo } from "./client.calc.js";
import { notifyProofSent } from "./client.notify.js";
import { dayKey, num, projectSnapshot, proofDto, proofSelect, requireClientOf, requireClientOrAdmin } from "./client.snapshot.js";
import type { ProofBody } from "./client.schema.js";

/** The projects this client is linked to */
export async function myProjects(userId: string) {
  const links = await prisma.projectClient.findMany({
    where: { userId },
    select: { project: { select: { id: true, title: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
  return links.map((l) => l.project);
}

/** One project as the client sees it, plus what needs their attention first */
export async function clientPortal(userId: string, projectId: string) {
  await requireClientOf(userId, projectId);
  const snap = await projectSnapshot(prisma, projectId);

  const attention: { kind: "advance" | "overdue" | "due" | "rejected" | "delay"; title: string; detail: string; instalmentId: string | null }[] = [];
  const advance = snap.instalments.find((i) => i.kind === "ADVANCE" && i.status !== "Paid" && i.status !== "Checking payment");
  if (advance && snap.advance === "Waiting for advance") {
    attention.push({ kind: "advance", title: `Advance of ₹${Math.round(advance.remaining).toLocaleString("en-IN")} is needed to start the work`, detail: advance.why, instalmentId: advance.id });
  }
  const date = (day: string | null) => (day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  for (const i of snap.instalments) {
    if (i.id === advance?.id && snap.advance === "Waiting for advance") continue;
    // The client's latest upload for this invoice was rejected: say why on the same card
    const rejected = i.status !== "Paid" && i.proofs[0]?.status === "REJECTED" && i.proofs[0].byClient ? i.proofs[0] : null;
    const why = rejected ? ` · Your last payment couldn't be confirmed: ${rejected.decisionNote || "please check it and upload again"}` : "";
    if (i.status === "Overdue") {
      attention.push({ kind: rejected ? "rejected" : "overdue", title: `${i.invoiceNo} · ${i.label} is overdue by ${i.daysOverdue} ${i.daysOverdue === 1 ? "day" : "days"}`, detail: `₹${Math.round(i.remaining).toLocaleString("en-IN")} was due on ${date(i.dueOn)}${why}`, instalmentId: i.id });
    } else if (i.status === "Due" || i.status === "Part paid") {
      attention.push({ kind: rejected ? "rejected" : "due", title: `${i.invoiceNo} · ${i.label} is due`, detail: `₹${Math.round(i.remaining).toLocaleString("en-IN")}${i.dueOn ? ` by ${date(i.dueOn)}` : ""} · ${i.why}${why}`, instalmentId: i.id });
    } else if (rejected) {
      attention.push({ kind: "rejected", title: `Your payment for ${i.invoiceNo} couldn't be confirmed`, detail: rejected.decisionNote || "Please check the details and upload it again.", instalmentId: i.id });
    }
  }
  const recent = snap.delays.find((d) => Date.now() - new Date(d.createdAt).getTime() < 14 * 86_400_000);
  if (recent) attention.push({ kind: "delay", title: `Schedule extended by ${recent.days} days`, detail: recent.title, instalmentId: null });

  // Clients don't need the internal notes on who recorded what beyond names; everything else is theirs to see
  return { ...snap, attention, generatedAt: new Date().toISOString() };
}

/** Everything an invoice shows. The linked client or an admin. */
export async function invoice(userId: string, instalmentId: string) {
  const inst = await prisma.paymentInstalment.findUnique({ where: { id: instalmentId }, select: { id: true, projectId: true } });
  if (!inst) throw new HttpError(404, "Invoice not found");
  await requireClientOrAdmin(userId, inst.projectId);

  const [snap, clients] = await Promise.all([
    projectSnapshot(prisma, inst.projectId),
    prisma.projectClient.findMany({ where: { projectId: inst.projectId }, select: { user: { select: { email: true, name: true } } } }),
  ]);
  const line = snap.instalments.find((i) => i.id === instalmentId)!;
  return {
    company: {
      name: process.env.COMPANY_NAME ?? "",
      address: process.env.COMPANY_ADDRESS ?? "",
      gstin: process.env.COMPANY_GSTIN ?? "",
      phone: process.env.COMPANY_PHONE ?? "",
      email: process.env.COMPANY_EMAIL ?? "",
      bank: process.env.COMPANY_BANK_DETAILS ?? "", // "Bank · A/c · IFSC · UPI id", printed for the client to pay into
    },
    billTo: clients.map((c) => c.user.name?.trim() || c.user.email),
    project: snap.project,
    progress: snap.schedule.done,
    instalment: { ...line, proofs: line.proofs.filter((p) => p.status === "APPROVED") },
    issuedOn: line.requestedAt?.slice(0, 10) ?? line.dueDate ?? dayKey(new Date())!,
  };
}

/* --------------------------------- uploading --------------------------------- */

/** The client sends a screenshot or PDF of a payment. It counts once an admin approves it. */
export async function uploadProof(userId: string, instalmentId: string, body: ProofBody, file: Express.Multer.File) {
  const inst = await prisma.paymentInstalment.findUnique({
    where: { id: instalmentId },
    select: { id: true, projectId: true, number: true, label: true, amount: true, taxPercent: true, project: { select: { title: true } }, proofs: { select: { amount: true, status: true } } },
  });
  if (!inst) throw new HttpError(404, "Invoice not found");
  await requireClientOf(userId, inst.projectId);

  const total = num(inst.amount) * (1 + num(inst.taxPercent) / 100);
  const counted = inst.proofs.filter((p) => p.status !== "REJECTED").reduce((s, p) => s + num(p.amount), 0);
  if (counted >= total - 0.5) throw new HttpError(409, "This invoice is already paid, or a payment for it is being checked.");
  if (body.amount > total - counted + 1) throw new HttpError(400, `That's more than is left on this invoice (₹${Math.round(total - counted).toLocaleString("en-IN")}).`);

  // Screenshots and PDFs only: a payment proof is never a drawing file
  const detected = detectFileType(file.buffer);
  if (!detected || detected.kind === "cad") throw new HttpError(415, "Upload a screenshot (PNG, JPG, WebP, GIF) or a PDF of the payment.");
  if (detected.kind === "image" && file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Screenshots can be up to 10 MB.");

  const stored = await uploadDrawingFile(file.buffer, detected);
  try {
    const proof = await prisma.$transaction(async (tx) => {
      const row = await tx.paymentProof.create({
        data: {
          instalmentId,
          projectId: inst.projectId,
          uploadedById: userId,
          amount: body.amount,
          paidOn: new Date(`${body.paidOn}T00:00:00.000Z`),
          mode: body.mode,
          reference: body.reference,
          note: body.note,
          publicId: stored.publicId,
          version: stored.version,
          format: stored.format,
          bytes: stored.bytes,
        },
        select: proofSelect,
      });
      await recordAudit(tx, {
        projectId: inst.projectId,
        actorId: userId,
        action: "payment.proof_uploaded",
        entityType: "project",
        entityId: row.id,
        summary: `Client sent a payment of ₹${body.amount.toLocaleString("en-IN")} for ${invoiceNo(inst.number)} (${inst.label}), to be checked`,
      });
      return row;
    });
    notifyProofSent({ projectTitle: inst.project.title, invoiceNo: invoiceNo(inst.number), label: inst.label, amount: body.amount, client: proof.uploadedBy.name?.trim() || proof.uploadedBy.email });
    return proofDto(proof);
  } catch (error) {
    await deleteDrawingFile(stored.publicId, detected.kind);
    throw error;
  }
}
