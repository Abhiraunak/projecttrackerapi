import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { deleteDrawingFile, drawingUrls, uploadDrawingFile } from "../../lib/cloudinary.js";
import { detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { recordAudit } from "../audit/audit.service.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import type { AddExpense } from "./expenses.schema.js";

/*
 * Daily expenditure: date, amount, purpose, remark, and the bill if there is one.
 * Seeing it needs "View projects"; adding or deleting needs "Create and edit projects".
 */

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const kindOf = (format: string) => (format === "pdf" ? "pdf" : "image") as "pdf" | "image";

type Row = { id: string; date: Date; amount: { toNumber(): number }; purpose: string; remark: string; billId: string | null; billVersion: number | null; billFormat: string | null; createdAt: Date; addedBy: { name: string | null; email: string } };

const dto = (e: Row) => ({
  id: e.id,
  date: ymd(e.date),
  amount: e.amount.toNumber(),
  purpose: e.purpose,
  remark: e.remark,
  // A private signed link to open the bill (photo or PDF); none when no bill was added
  billUrl: e.billId && e.billVersion !== null && e.billFormat ? drawingUrls({ publicId: e.billId, version: e.billVersion, format: e.billFormat, kind: kindOf(e.billFormat) }).openUrl : null,
  addedBy: e.addedBy.name || e.addedBy.email,
  createdAt: e.createdAt,
});

const select = { id: true, date: true, amount: true, purpose: true, remark: true, billId: true, billVersion: true, billFormat: true, createdAt: true, addedBy: { select: { name: true, email: true } } } as const;

/** GET /projects/:id/expenses: newest first, with the totals for this month and all time */
export async function listExpenses(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "project.view");
  const rows = await prisma.expense.findMany({ where: { projectId }, select, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  const month = dayKeyIn(new Date()).slice(0, 7);
  const items = rows.map(dto);
  const sum = (list: typeof items) => Math.round(list.reduce((s, e) => s + e.amount, 0) * 100) / 100;
  return { items, total: sum(items), thisMonth: sum(items.filter((e) => e.date.startsWith(month))) };
}

/** POST /projects/:id/expenses: one payment, with an optional bill (photo or PDF) */
export async function addExpense(userId: string, projectId: string, input: AddExpense, file?: Express.Multer.File) {
  await requirePermission(userId, projectId, "project.manage");
  if (input.date > dayKeyIn(new Date())) throw new HttpError(400, "The date can't be in the future.");

  let bill: { billId: string; billVersion: number; billFormat: string } | null = null;
  if (file) {
    const detected = detectFileType(file.buffer);
    if (!detected || detected.kind === "cad") throw new HttpError(415, "Bills can be a photo (JPG, PNG, WebP) or a PDF.");
    if (detected.kind === "image" && file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Photos can be up to 10 MB.");
    const stored = await uploadDrawingFile(file.buffer, detected);
    bill = { billId: stored.publicId, billVersion: stored.version, billFormat: stored.format };
  }

  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: { projectId, date: new Date(`${input.date}T00:00:00Z`), amount: input.amount, purpose: input.purpose, remark: input.remark, addedById: userId, ...bill },
        select,
      });
      await recordAudit(tx, {
        projectId,
        actorId: userId,
        action: "expense.added",
        entityType: "project",
        entityId: created.id,
        summary: `Added expenditure of ${input.amount} on ${input.date}: ${input.purpose}`,
      });
      return created;
    });
    return { expense: dto(row) };
  } catch (err) {
    if (bill) await deleteDrawingFile(bill.billId, kindOf(bill.billFormat)); // never leave an orphan bill behind
    throw err;
  }
}

/** DELETE /projects/:id/expenses/:expenseId */
export async function removeExpense(userId: string, projectId: string, expenseId: string) {
  await requirePermission(userId, projectId, "project.manage");
  const before = await prisma.expense.findFirst({ where: { id: expenseId, projectId } });
  if (!before) throw new HttpError(404, "Entry not found");
  await prisma.$transaction(async (tx) => {
    await tx.expense.delete({ where: { id: expenseId } });
    await recordAudit(tx, {
      projectId,
      actorId: userId,
      action: "expense.deleted",
      entityType: "project",
      entityId: expenseId,
      summary: `Deleted expenditure of ${before.amount.toNumber()} on ${ymd(before.date)}: ${before.purpose}`,
    });
  });
  if (before.billId && before.billFormat) await deleteDrawingFile(before.billId, kindOf(before.billFormat));
  return { ok: true };
}
