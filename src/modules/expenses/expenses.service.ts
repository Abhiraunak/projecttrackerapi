import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { deleteDrawingFile, drawingUrls, uploadDrawingFile } from "../../lib/cloudinary.js";
import { detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { recordAudit } from "../audit/audit.service.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { EXPENSE_CATEGORIES, type AddExpense, type UpdateExpense } from "./expenses.schema.js";

/*
 * Daily expenditure: date, amount, purpose, remark, and the bill if there is one.
 * Seeing it needs "View projects"; adding or deleting needs "Create and edit projects".
 */

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const kindOf = (format: string) => (format === "pdf" ? "pdf" : "image") as "pdf" | "image";

type Row = { id: string; category: string; date: Date; amount: { toNumber(): number }; purpose: string; remark: string; archivedAt: Date | null; billId: string | null; billVersion: number | null; billFormat: string | null; createdAt: Date; addedBy: { name: string | null; email: string } };

const dto = (e: Row) => ({
  id: e.id,
  category: e.category,
  date: ymd(e.date),
  amount: e.amount.toNumber(),
  purpose: e.purpose,
  remark: e.remark,
  // A private signed link to open the bill (photo or PDF); none when no bill was added
  billUrl: e.billId && e.billVersion !== null && e.billFormat ? drawingUrls({ publicId: e.billId, version: e.billVersion, format: e.billFormat, kind: kindOf(e.billFormat) }).openUrl : null,
  addedBy: e.addedBy.name || e.addedBy.email,
  createdAt: e.createdAt,
});

const select = { id: true, category: true, date: true, amount: true, purpose: true, remark: true, archivedAt: true, billId: true, billVersion: true, billFormat: true, createdAt: true, addedBy: { select: { name: true, email: true } } } as const;

/** GET /projects/:id/expenses: newest first, with this month's and all-time totals, overall and for each section */
export async function listExpenses(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "project.view");
  const rows = await prisma.expense.findMany({ where: { projectId }, select, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  const month = dayKeyIn(new Date()).slice(0, 7);
  // Archived entries count nowhere; they are listed apart, to restore or delete for good
  const items = rows.filter((r) => !r.archivedAt).map(dto);
  const archived = rows.filter((r) => r.archivedAt).map(dto);
  const sum = (list: typeof items) => Math.round(list.reduce((s, e) => s + e.amount, 0) * 100) / 100;
  const totals = (list: typeof items) => ({ total: sum(list), thisMonth: sum(list.filter((e) => e.date.startsWith(month))) });
  return {
    items,
    archived,
    ...totals(items),
    byCategory: Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, totals(items.filter((e) => e.category === c))])),
  };
}

/** POST /projects/:id/expenses: one payment, with an optional bill (photo or PDF) */
export async function addExpense(userId: string, projectId: string, input: AddExpense, file?: Express.Multer.File) {
  await requirePermission(userId, projectId, "expenses.manage"); // the General section's one tick
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
        data: { projectId, category: input.category, date: new Date(`${input.date}T00:00:00Z`), amount: input.amount, purpose: input.purpose, remark: input.remark, addedById: userId, ...bill },
        select,
      });
      await recordAudit(tx, {
        projectId,
        actorId: userId,
        action: "expense.added",
        entityType: "project",
        entityId: created.id,
        summary: `Added ${input.category} expenditure of ${input.amount} on ${input.date}: ${input.purpose}`,
      });
      return created;
    });
    return { expense: dto(row) };
  } catch (err) {
    if (bill) await deleteDrawingFile(bill.billId, kindOf(bill.billFormat)); // never leave an orphan bill behind
    throw err;
  }
}

/** PUT /projects/:id/expenses/:expenseId: change the date, amount, purpose or remark; attach, replace or remove the bill */
export async function updateExpense(userId: string, projectId: string, expenseId: string, input: UpdateExpense, file?: Express.Multer.File) {
  await requirePermission(userId, projectId, "expenses.manage"); // the General section's one tick
  if (input.date > dayKeyIn(new Date())) throw new HttpError(400, "The date can't be in the future.");
  const before = await prisma.expense.findFirst({ where: { id: expenseId, projectId, archivedAt: null } });
  if (!before) throw new HttpError(404, "Entry not found");

  let bill: { billId: string; billVersion: number; billFormat: string } | null = null;
  if (file) {
    const detected = detectFileType(file.buffer);
    if (!detected || detected.kind === "cad") throw new HttpError(415, "Bills can be a photo (JPG, PNG, WebP) or a PDF.");
    if (detected.kind === "image" && file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Photos can be up to 10 MB.");
    const stored = await uploadDrawingFile(file.buffer, detected);
    bill = { billId: stored.publicId, billVersion: stored.version, billFormat: stored.format };
  }
  // A new file replaces the bill; "remove" clears it; otherwise the bill stays as it is
  const billData = bill ?? (input.removeBill ? { billId: null, billVersion: null, billFormat: null } : {});

  try {
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: expenseId },
        data: { category: input.category, date: new Date(`${input.date}T00:00:00Z`), amount: input.amount, purpose: input.purpose, remark: input.remark, ...billData },
        select,
      });
      await recordAudit(tx, {
        projectId,
        actorId: userId,
        action: "expense.updated",
        entityType: "expense",
        entityId: expenseId,
        summary: `Changed ${input.category} expenditure · ${input.purpose} · ₹${Math.round(input.amount).toLocaleString("en-IN")}${bill ? " · bill attached" : input.removeBill ? " · bill removed" : ""}`,
      });
      return updated;
    });
    // The old file goes once the change is saved (it was replaced or removed)
    if ((bill || input.removeBill) && before.billId && before.billFormat) await deleteDrawingFile(before.billId, kindOf(before.billFormat)).catch(() => { });
    return { expense: dto(row) };
  } catch (err) {
    if (bill) await deleteDrawingFile(bill.billId, kindOf(bill.billFormat)); // never leave an orphan bill behind
    throw err;
  }
}

/** POST /projects/:id/expenses/:expenseId/archive and …/restore: archived entries count nowhere until restored */
export async function archiveExpense(userId: string, projectId: string, expenseId: string, archive: boolean) {
  await requirePermission(userId, projectId, "expenses.manage");
  const before = await prisma.expense.findFirst({ where: { id: expenseId, projectId, archivedAt: archive ? null : { not: null } } });
  if (!before) throw new HttpError(404, archive ? "That entry is no longer there." : "That entry isn't archived.");
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id: expenseId }, data: { archivedAt: archive ? new Date() : null } });
    await recordAudit(tx, {
      projectId,
      actorId: userId,
      action: archive ? "expense.archived" : "expense.restored",
      entityType: "expense",
      entityId: expenseId,
      summary: `${archive ? "Archived" : "Restored"} ${before.category} expenditure · ${before.purpose} · ₹${Math.round(before.amount.toNumber()).toLocaleString("en-IN")}`,
    });
  });
  return { ok: true };
}

/** DELETE /projects/:id/expenses/:expenseId: for good, and only an archived entry */
export async function removeExpense(userId: string, projectId: string, expenseId: string) {
  await requirePermission(userId, projectId, "expenses.manage"); // the General section's one tick
  const before = await prisma.expense.findFirst({ where: { id: expenseId, projectId } });
  if (!before) throw new HttpError(404, "Entry not found");
  if (!before.archivedAt) throw new HttpError(409, "Archive the entry first; only archived entries can be deleted.");
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