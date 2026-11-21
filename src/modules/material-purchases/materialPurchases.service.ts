import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../lib/error.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { deleteDrawingFile, drawingUrls, uploadDrawingFile } from "../../lib/cloudinary.js";
import { detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { recordAudit } from "../audit/audit.service.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { amountOf, arrivalOf, canonicalName, round2, spentOf, summarize } from "./materialPurchases.calc.js";
import type { AddDelivery, AddPurchase, UpdatePurchase } from "./materialPurchases.schema.js";

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
  section: true,
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
  archivedAt: true,
  addedBy: { select: { name: true, email: true } },
  deliveries: {
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { id: true, date: true, quantity: true, rate: true, amount: true, ratePending: true, archivedAt: true, billId: true, billVersion: true, billFormat: true, addedBy: { select: { name: true, email: true } } },
  },
  topUps: {
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: { id: true, date: true, quantity: true, rate: true, amount: true, note: true, billId: true, billVersion: true, billFormat: true, addedBy: true },
  },
} satisfies Prisma.MaterialPurchaseSelect; // not "as const": that makes orderBy a read-only array, which Prisma refuses

type BillCols = { billId: string | null; billVersion: number | null; billFormat: string | null };
type Num = { toNumber(): number };
type DeliveryRow = BillCols & { id: string; date: Date; quantity: Num; rate: Num; amount: Num; ratePending?: boolean; archivedAt?: Date | null; addedBy: { name: string | null; email: string } };

const billOf = (p: BillCols) => ({
  billUrl:
    p.billId && p.billVersion !== null && p.billFormat
      ? drawingUrls({ publicId: p.billId, version: p.billVersion, format: p.billFormat, kind: kindOf(p.billFormat) }).openUrl
      : null,
  billKind: p.billFormat ? kindOf(p.billFormat) : null,
});

const deliveryDto = (d: DeliveryRow) => ({
  id: d.id,
  date: ymd(d.date),
  quantity: d.quantity.toNumber(),
  rate: d.rate.toNumber(), // what was actually paid per unit
  amount: d.amount.toNumber(), // quantity × rate
  ratePending: d.ratePending ?? false, // no rate or amount yet ("Not set"): from the site diary, or logged without one
  archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
  ...billOf(d),
  addedBy: d.addedBy.name || d.addedBy.email,
});

type Row = {
  id: string;
  section: string;
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
  archivedAt?: Date | null;
  addedBy: { name: string | null; email: string };
  deliveries: DeliveryRow[];
  topUps: (BillCols & { id: string; date: Date; quantity: Num; rate: Num; amount: Num; note: string; addedBy: string })[];
};

const dto = (p: Row) => {
  // Archived deliveries are kept aside: they count nowhere until restored, and only they can be deleted
  const all = p.deliveries.map(deliveryDto);
  const deliveries = all.filter((d) => !d.archivedAt);
  const archived = all.filter((d) => d.archivedAt);
  // More added later, oldest first: "+5,000 on 8 Nov". The quantity is the total of the first lot and these.
  const additions = p.topUps.map((t) => ({
    id: t.id,
    date: ymd(t.date),
    quantity: t.quantity.toNumber(),
    rate: t.rate.toNumber(),
    amount: t.amount.toNumber(),
    note: t.note,
    ...billOf(t),
    addedBy: t.addedBy,
  }));
  const added = round2(additions.reduce((s, a) => s + a.quantity, 0));
  return {
    id: p.id,
    section: p.section,
    name: p.name,
    unit: p.unit,
    quantity: p.quantity.toNumber(),
    rate: p.rate.toNumber(), // the preset (planned) rate
    amount: p.amount.toNumber(), // preset cost: quantity ordered × the preset rate
    spent: spentOf(deliveries), // actual spending: every delivery's quantity × the rate paid
    date: ymd(p.date),
    note: p.note,
    ...billOf(p),
    addedBy: p.addedBy.name || p.addedBy.email,
    createdAt: p.createdAt,
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    // Deliveries: on what date how many arrived and at what rate; the quantity above is what was ordered
    deliveries,
    archived,
    firstQuantity: round2(p.quantity.toNumber() - added), // the first lot, on `date`
    additions,
    ...arrivalOf(p.quantity.toNumber(), deliveries),
  };
};

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

/** Section headings already used on this project, in the order they were first used */
async function knownSections(projectId: string) {
  const rows = await prisma.materialPurchase.findMany({ where: { projectId, section: { not: "" } }, select: { section: true }, orderBy: { createdAt: "asc" } });
  return [...new Set(rows.map((r) => r.section))];
}

/** GET /projects/:projectId/material-purchases: every purchase (newest first), each material's total, and the grand total */
export async function listPurchases(userId: string, projectId: string) {
  await requirePermission(userId, projectId, VIEW);
  const [rows, names, sections] = await Promise.all([
    prisma.materialPurchase.findMany({ where: { projectId }, select, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
    knownNames(projectId),
    knownSections(projectId),
  ]);
  const all = rows.map(dto);
  // Archived materials are listed apart and count nowhere until restored
  const items = all.filter((i) => !i.archivedAt);
  const archived = all.filter((i) => i.archivedAt);
  // total = preset cost of everything ordered; spentTotal = what the deliveries actually cost
  return { items, archived, ...summarize(items), spentTotal: round2(items.reduce((s, i) => s + i.spent, 0)), names, sections };
}

/**
 * POST /projects/:projectId/material-purchases. A material already on the list (same name, whatever the case or
 * spacing) is not added twice: the quantity is added to it, with the date, as "+5,000 on 8 Nov".
 */
export async function addPurchase(userId: string, projectId: string, input: AddPurchase, file?: Express.Multer.File) {
  await requirePermission(userId, projectId, WRITE);
  checkDate(input.date);
  const name = canonicalName(input.name, (await knownNames(projectId)).map((n) => n.name));
  const existing = await prisma.materialPurchase.findFirst({
    where: { projectId, archivedAt: null, name: { equals: name, mode: "insensitive" } }, // an archived one isn't added to
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, unit: true, quantity: true, amount: true },
  });
  if (existing) return addMore(userId, projectId, existing, input, file);
  const section = canonicalName(input.section, await knownSections(projectId));
  const amount = amountOf(input.quantity, input.rate);
  const bill = await storeBill(file);

  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.materialPurchase.create({
        data: { projectId, section, name, unit: input.unit, quantity: input.quantity, rate: input.rate, amount, date: new Date(`${input.date}T00:00:00Z`), note: input.note, addedById: userId, ...bill },
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

/** More of a material already on the list: the total grows, and the addition is kept with its date */
async function addMore(
  userId: string,
  projectId: string,
  existing: { id: string; name: string; unit: string; quantity: Num; amount: Num },
  input: AddPurchase,
  file?: Express.Multer.File
) {
  if (existing.unit && input.unit && existing.unit.toLowerCase() !== input.unit.toLowerCase())
    throw new HttpError(400, `${existing.name} is counted in ${existing.unit}. Enter the quantity in ${existing.unit} to add it.`);
  const lot = amountOf(input.quantity, input.rate);
  const quantity = round2(existing.quantity.toNumber() + input.quantity);
  const amount = round2(existing.amount.toNumber() + lot);
  const rate = quantity > 0 ? round2(amount / quantity) : input.rate; // the preset rate becomes the average if lots differ
  const who = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  const bill = await storeBill(file);

  try {
    const row = await prisma.$transaction(async (tx) => {
      await tx.materialTopUp.create({
        data: {
          purchaseId: existing.id,
          quantity: input.quantity,
          rate: input.rate,
          amount: lot,
          date: new Date(`${input.date}T00:00:00Z`),
          note: input.note,
          addedBy: who?.name || who?.email || "Someone",
          ...bill,
        },
      });
      const updated = await tx.materialPurchase.update({ where: { id: existing.id }, data: { quantity, amount, rate }, select });
      await recordAudit(tx, {
        projectId,
        actorId: userId,
        action: "material_purchase.added_more",
        entityType: "project",
        entityId: existing.id,
        summary: `Added ${input.quantity} ${existing.unit || input.unit || ""} more ${existing.name} on ${input.date}, now ${quantity}`.replace(/\s+/g, " "),
      });
      return updated;
    });
    return { purchase: dto(row), addedTo: { name: existing.name, quantity: input.quantity, total: quantity } };
  } catch (err) {
    if (bill) await dropBill(bill);
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
  const section = canonicalName(input.section, await knownSections(projectId));
  const amount = amountOf(input.quantity, input.rate);
  const bill = await storeBill(file);
  const clearBill = !bill && input.removeBill;

  try {
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.materialPurchase.update({
        where: { id: purchaseId },
        data: {
          section,
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

/** POST …/material-purchases/:purchaseId/archive: archive (off the list, counted nowhere, deliveries kept) or restore */
export async function archivePurchase(userId: string, projectId: string, purchaseId: string, archived: boolean) {
  await requirePermission(userId, projectId, WRITE);
  const found = await prisma.materialPurchase.findFirst({ where: { id: purchaseId, projectId }, select: { id: true } });
  if (!found) throw new HttpError(404, "That material is no longer there.");
  const row = await prisma.materialPurchase.update({ where: { id: purchaseId }, data: { archivedAt: archived ? new Date() : null }, select });
  return { purchase: dto(row) };
}

const billsOf = { billId: true, billFormat: true } as const;

/**
 * POST …/material-purchases/bulk-delete: delete several archived materials for good, with their deliveries and
 * additions (they cascade). All or nothing: every id must be an archived material of this project, and the rows go in
 * one transaction, so a failure leaves the database exactly as it was. The bill files are removed only after that.
 */
export async function removePurchases(userId: string, projectId: string, ids: string[]) {
  await requirePermission(userId, projectId, WRITE);
  const unique = [...new Set(ids)];
  const rows = await prisma.materialPurchase.findMany({
    where: { id: { in: unique }, projectId },
    select: { id: true, archivedAt: true, ...billsOf, deliveries: { select: billsOf }, topUps: { select: billsOf } },
  });
  if (rows.length !== unique.length) throw new HttpError(404, "Some of those materials are no longer there. Refresh and try again.");
  if (rows.some((r) => !r.archivedAt)) throw new HttpError(400, "Only archived materials can be deleted. Archive them first.");

  await prisma.$transaction(async (tx) => {
    // archivedAt is checked again inside the transaction: nothing restored a moment ago is deleted
    const gone = await tx.materialPurchase.deleteMany({ where: { id: { in: unique }, projectId, archivedAt: { not: null } } });
    if (gone.count !== unique.length) throw new HttpError(409, "Some of those materials changed just now. Nothing was deleted; refresh and try again.");
  });

  // Files last, once the rows are surely gone; a file that fails to delete never brings a row back
  const bills = rows.flatMap((r) => [r, ...r.deliveries, ...r.topUps]);
  await Promise.allSettled(bills.map((b) => dropBill(b)));
  return { deleted: unique.length };
}

/** DELETE /projects/:projectId/material-purchases/:purchaseId: one archived material */
export async function removePurchase(userId: string, projectId: string, purchaseId: string) {
  await requirePermission(userId, projectId, WRITE);
  const before = await prisma.materialPurchase.findFirst({ where: { id: purchaseId, projectId }, include: { deliveries: { select: { billId: true, billFormat: true } }, topUps: { select: { billId: true, billFormat: true } } } });
  if (!before) throw new HttpError(404, "That entry is no longer there.");
  if (!before.archivedAt) throw new HttpError(400, "Archive the material first; it can be deleted from Archived materials.");
  await prisma.$transaction(async (tx) => {
    await tx.materialPurchase.delete({ where: { id: purchaseId } }); // its deliveries go with it
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
  for (const d of before.deliveries) await dropBill(d);
  for (const t of before.topUps) await dropBill(t);
  return { ok: true };
}

/**
 * For the project cards, Overview and Expenditure: per project, the preset cost of the materials on the list
 * (planned) and what their deliveries actually cost (spent).
 */
export async function purchaseTotalsByProject(projectIds: string[]): Promise<Map<string, { planned: number; spent: number }>> {
  if (projectIds.length === 0) return new Map();
  const [planned, spent] = await Promise.all([
    prisma.materialPurchase.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, archivedAt: null }, _sum: { amount: true } }),
    prisma.materialDelivery.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, archivedAt: null, purchase: { archivedAt: null } }, _sum: { amount: true } }),
  ]);
  const out = new Map<string, { planned: number; spent: number }>(projectIds.map((id) => [id, { planned: 0, spent: 0 }]));
  for (const r of planned) out.get(r.projectId)!.planned = r._sum.amount?.toNumber() ?? 0;
  for (const r of spent) out.get(r.projectId)!.spent = r._sum.amount?.toNumber() ?? 0;
  return out;
}

/* ------------------------------------------- deliveries ------------------------------------------- */

async function purchaseIn(projectId: string, purchaseId: string, { active = false } = {}) {
  const p = await prisma.materialPurchase.findFirst({ where: { id: purchaseId, projectId }, select: { id: true, name: true, unit: true, archivedAt: true } });
  if (!p) throw new HttpError(404, "That material is no longer on the list.");
  if (active && p.archivedAt) throw new HttpError(400, `${p.name} is archived. Restore it to add or change deliveries.`);
  return p;
}

/**
 * What a delivery cost, from what was typed: the amount if given (the rate then follows from it), else quantity × rate,
 * else nothing yet ("Not set": ratePending, counts ₹0 until edited).
 */
function costOf(input: AddDelivery) {
  if (input.amount !== undefined) {
    const rate = input.rate ?? Math.round((input.amount / input.quantity) * 100) / 100;
    return { rate, amount: round2(input.amount), ratePending: false };
  }
  if (input.rate !== undefined) return { rate: input.rate, amount: amountOf(input.quantity, input.rate), ratePending: false };
  return { rate: 0, amount: 0, ratePending: true };
}

async function deliveryIn(purchaseId: string, deliveryId: string) {
  const d = await prisma.materialDelivery.findFirst({ where: { id: deliveryId, purchaseId } });
  if (!d) throw new HttpError(404, "That delivery is no longer there.");
  return d;
}

const purchaseNow = async (purchaseId: string) => ({ purchase: dto(await prisma.materialPurchase.findUniqueOrThrow({ where: { id: purchaseId }, select })) });

/** POST /projects/:projectId/material-purchases/:purchaseId/deliveries: on this date, this many arrived at this rate (bill optional) */
export async function addDelivery(userId: string, projectId: string, purchaseId: string, input: AddDelivery, file?: Express.Multer.File) {
  await requirePermission(userId, projectId, WRITE);
  checkDate(input.date);
  const purchase = await purchaseIn(projectId, purchaseId, { active: true });
  const bill = await storeBill(file);
  const cost = costOf(input);
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.materialDelivery.create({
        data: { purchaseId, projectId, date: new Date(`${input.date}T00:00:00Z`), quantity: input.quantity, ...cost, addedById: userId, ...bill },
        select: { id: true },
      });
      await recordAudit(tx, {
        projectId,
        actorId: userId,
        action: "material_delivery.added",
        entityType: "project",
        entityId: created.id,
        summary: `${input.quantity} ${purchase.unit} ${purchase.name} arrived on ${input.date}${cost.ratePending ? "" : ` = ${cost.amount}`}`.replace(/\s+/g, " "),
      });
    });
  } catch (err) {
    if (bill) await dropBill(bill);
    throw err;
  }
  const row = await prisma.materialPurchase.findUniqueOrThrow({ where: { id: purchaseId }, select });
  return { purchase: dto(row) };
}

/** PUT /projects/:projectId/material-purchases/:purchaseId/deliveries/:deliveryId: correct the date, how many, rate or amount */
export async function updateDelivery(userId: string, projectId: string, purchaseId: string, deliveryId: string, input: AddDelivery) {
  await requirePermission(userId, projectId, WRITE);
  checkDate(input.date);
  await purchaseIn(projectId, purchaseId, { active: true });
  await deliveryIn(purchaseId, deliveryId);
  await prisma.materialDelivery.update({
    where: { id: deliveryId },
    data: { date: new Date(`${input.date}T00:00:00Z`), quantity: input.quantity, ...costOf(input) },
  });
  return purchaseNow(purchaseId);
}

/** POST …/deliveries/:deliveryId/archive: archive (stops counting in arrived and spent) or restore */
export async function archiveDelivery(userId: string, projectId: string, purchaseId: string, deliveryId: string, archived: boolean) {
  await requirePermission(userId, projectId, WRITE);
  await purchaseIn(projectId, purchaseId);
  await deliveryIn(purchaseId, deliveryId);
  await prisma.materialDelivery.update({ where: { id: deliveryId }, data: { archivedAt: archived ? new Date() : null } });
  return purchaseNow(purchaseId);
}

/** DELETE /projects/:projectId/material-purchases/:purchaseId/deliveries/:deliveryId: only an archived delivery */
export async function removeDelivery(userId: string, projectId: string, purchaseId: string, deliveryId: string) {
  await requirePermission(userId, projectId, WRITE);
  const purchase = await purchaseIn(projectId, purchaseId);
  const before = await deliveryIn(purchaseId, deliveryId);
  if (!before.archivedAt) throw new HttpError(400, "Archive the delivery first; it can be deleted from Archived.");
  await prisma.$transaction(async (tx) => {
    await tx.materialDelivery.delete({ where: { id: deliveryId } });
    await recordAudit(tx, {
      projectId,
      actorId: userId,
      action: "material_delivery.deleted",
      entityType: "project",
      entityId: deliveryId,
      summary: `Deleted the delivery of ${before.quantity.toNumber()} ${purchase.unit} ${purchase.name} on ${ymd(before.date)}`.replace(/\s+/g, " "),
    });
  });
  await dropBill(before);
  const row = await prisma.materialPurchase.findUniqueOrThrow({ where: { id: purchaseId }, select });
  return { purchase: dto(row) };
}