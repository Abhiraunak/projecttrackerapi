import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { deleteDrawingFile, drawingUrls, uploadDrawingFile } from "../../lib/cloudinary.js";
import { detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { recordAudit } from "../audit/audit.service.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { amountOf, canonicalName, summarize } from "./materialPurchases.calc.js";
import type { AddPurchase, UpdatePurchase } from "./materialPurchases.schema.js";

/*
 * The simple Materials tab: materials bought for the project, each with a quantity, a rate and (optionally) the bill.
 * Seeing them needs "View materials"; adding, changing or deleting needs "Receive stock".
 */

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const kindOf = (format: string) => (format === "pdf" ? "pdf" : "image") as "pdf" | "image";
const VIEW = "materials.view";
const WRITE = "stock.receive";

const select = {
  id: true,
  name: true,
  unit: true,
  quantity: true,
  rate: true,
  amount: true,
  date: true,
  note: true,
  billId: true,
  billVersion: true,
  billFormat: true,
  createdAt: true,
  addedBy: { select: { name: true, email: true } },
} as const;

type Row = {
  id: string;
  name: string;
  unit: string;
  quantity: { toNumber(): number };
  rate: { toNumber(): number };
  amount: { toNumber(): number };
  date: Date;
  note: string;
  billId: string | null;
  billVersion: number | null;
  billFormat: string | null;
  createdAt: Date;
  addedBy: { name: string | null; email: string };
};

const dto = (p: Row) => ({
  id: p.id,
  name: p.name,
  unit: p.unit,
  quantity: p.quantity.toNumber(),
  rate: p.rate.toNumber(),
  amount: p.amount.toNumber(),
  date: ymd(p.date),
  note: p.note,
  billUrl:
    p.billId && p.billVersion !== null && p.billFormat
      ? drawingUrls({ publicId: p.billId, version: p.billVersion, format: p.billFormat, kind: kindOf(p.billFormat) }).openUrl
      : null,
  billKind: p.billFormat ? kindOf(p.billFormat) : null,
  addedBy: p.addedBy.name || p.addedBy.email,
  createdAt: p.createdAt,
});

type Bill = { billId: string; billVersion: number; billFormat: string };

async function storeBill(file?: Express.Multer.File): Promise<Bill | null> {
  if (!file) return null;
  const detected = detectFileType(file.buffer);
  if (!detected || detected.kind === "cad") throw new HttpError(415, "The bill can be a photo (JPG, PNG, WebP) or a PDF.");
  if (detected.kind === "image" && file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Photos can be up to 10 MB.");
  const stored = await uploadDrawingFile(file.buffer, detected);
  return { billId: stored.publicId, billVersion: stored.version, billFormat: stored.format };
}
const dropBill = (b: { billId: string | null; billFormat: string | null }) =>
  b.billId && b.billFormat ? deleteDrawingFile(b.billId, kindOf(b.billFormat)) : Promise.resolve();

function checkDate(date: string) {
  if (date > dayKeyIn(new Date())) throw new HttpError(400, "The date can't be in the future.");
}

/** Names (and their units) already used on this project, newest first, so "Bricks" is picked rather than retyped */
async function knownNames(projectId: string) {
  const rows = await prisma.materialPurchase.findMany({ where: { projectId }, distinct: ["name"], select: { name: true, unit: true }, orderBy: { createdAt: "desc" } });
  return rows;
}

/** GET /projects/:projectId/material-purchases: every purchase (newest first), each material's total, and the grand total */
export async function listPurchases(userId: string, projectId: string) {
  await requirePermission(userId, projectId, VIEW);
  const [rows, names] = await Promise.all([
    prisma.materialPurchase.findMany({ where: { projectId }, select, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
    knownNames(projectId),
  ]);
  const items = rows.map(dto);
  return { items, ...summarize(items), names };
}

/** POST /projects/:projectId/material-purchases */
export async function addPurchase(userId: string, projectId: string, input: AddPurchase, file?: Express.Multer.File) {
  await requirePermission(userId, projectId, WRITE);
  checkDate(input.date);
  const name = canonicalName(input.name, (await knownNames(projectId)).map((n) => n.name));
  const amount = amountOf(input.quantity, input.rate);
  const bill = await storeBill(file);

  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.materialPurchase.create({
        data: { projectId, name, unit: input.unit, quantity: input.quantity, rate: input.rate, amount, date: new Date(`${input.date}T00:00:00Z`), note: input.note, addedById: userId, ...bill },
        select,
      });
      await recordAudit(tx, {
        projectId,
        actorId: userId,
        action: "material_purchase.added",
        entityType: "project",
        entityId: created.id,
        summary: `Added ${input.quantity} ${input.unit || ""} ${name} at ${input.rate} = ${amount}`.replace(/\s+/g, " "),
      });
      return created;
    });
    return { purchase: dto(row) };
  } catch (err) {
    if (bill) await dropBill(bill); // never leave an orphan bill behind
    throw err;
  }
}

/** PUT /projects/:projectId/material-purchases/:purchaseId: change the figures; a new file replaces the bill */
export async function updatePurchase(userId: string, projectId: string, purchaseId: string, input: UpdatePurchase, file?: Express.Multer.File) {
  await requirePermission(userId, projectId, WRITE);
  const before = await prisma.materialPurchase.findFirst({ where: { id: purchaseId, projectId } });
  if (!before) throw new HttpError(404, "That entry is no longer there.");
  checkDate(input.date);
  const others = (await knownNames(projectId)).map((n) => n.name).filter((n) => n !== before.name);
  const name = canonicalName(input.name, others);
  const amount = amountOf(input.quantity, input.rate);
  const bill = await storeBill(file);
  const clearBill = !bill && input.removeBill;

  try {
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.materialPurchase.update({
        where: { id: purchaseId },
        data: {
          name,
          unit: input.unit,
          quantity: input.quantity,
          rate: input.rate,
          amount,
          date: new Date(`${input.date}T00:00:00Z`),
          note: input.note,
          ...(bill ?? {}),
          ...(clearBill ? { billId: null, billVersion: null, billFormat: null } : {}),
        },
        select,
      });
      await recordAudit(tx, {
        projectId,
        actorId: userId,
        action: "material_purchase.updated",
        entityType: "project",
        entityId: purchaseId,
        summary: `Changed ${before.name}: ${before.quantity.toNumber()} at ${before.rate.toNumber()} → ${input.quantity} at ${input.rate} = ${amount}`,
      });
      return updated;
    });
    if (bill || clearBill) await dropBill(before); // the old bill goes only once the change is saved
    return { purchase: dto(row) };
  } catch (err) {
    if (bill) await dropBill(bill);
    throw err;
  }
}

/** DELETE /projects/:projectId/material-purchases/:purchaseId */
export async function removePurchase(userId: string, projectId: string, purchaseId: string) {
  await requirePermission(userId, projectId, WRITE);
  const before = await prisma.materialPurchase.findFirst({ where: { id: purchaseId, projectId } });
  if (!before) throw new HttpError(404, "That entry is no longer there.");
  await prisma.$transaction(async (tx) => {
    await tx.materialPurchase.delete({ where: { id: purchaseId } });
    await recordAudit(tx, {
      projectId,
      actorId: userId,
      action: "material_purchase.deleted",
      entityType: "project",
      entityId: purchaseId,
      summary: `Deleted ${before.quantity.toNumber()} ${before.unit} ${before.name} (${before.amount.toNumber()}) of ${ymd(before.date)}`.replace(/\s+/g, " "),
    });
  });
  await dropBill(before);
  return { ok: true };
}

/** The material purchases' total per project, for the project cards, the hub and the Expenditure tab */
export async function purchaseTotalsByProject(projectIds: string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await prisma.materialPurchase.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds } }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.projectId, r._sum.amount?.toNumber() ?? 0]));
}