import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { MOVEMENT_PERMISSION } from "../../lib/permissions.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { deleteDrawingFile, drawingUrls, uploadDrawingFile } from "../../lib/cloudinary.js";
import { detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { refreshAlertsSoon } from "../alerts/alerts.service.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { movementDto, toMaterialInfo } from "./inventory.mapper.js";
import { recordMovementIn, stockInputs } from "./inventory.service.js";
import { ADDED_BY_HAND, groupBySection, lastMonths, monthly, moveFigures, OTHER, sectionOf, totals, type ListMaterial, type Move } from "./materialsTab.calc.js";
import { buildInventory, inventoryItemFor, type InventoryItem } from "./stock.js";
import type { QuickMoveBody } from "./inventory.schema.js";

/*
 * The project's Materials tab: one list grouped by section, a bar graph of received and issued by month, and a page
 * per material with its numbers, graph, what needs it and the log. Seeing it needs "View materials"; receiving and
 * issuing need the same permissions as the full inventory screen.
 */

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (m: { date: Date | null; createdAt: Date }) => (m.date ? ymd(m.date) : dayKeyIn(m.createdAt));
const kindOf = (format: string) => (format === "pdf" ? "pdf" : "image") as "pdf" | "image";

/** Each need's section: the BOQ item's section, or what a hand-added need is for */
async function sectionsOfNeeds(projectId: string) {
  const [items, estimates] = await Promise.all([
    prisma.boqItem.findMany({ where: { projectId }, select: { id: true, sheetName: true }, orderBy: { createdAt: "asc" } }),
    prisma.materialEstimate.findMany({ where: { projectId }, select: { id: true, title: true } }),
  ]);
  const of = new Map<string, string>();
  for (const i of items) of.set(i.id, i.sheetName.trim() || "BOQ");
  for (const e of estimates) of.set(`est:${e.id}`, e.title.trim() || ADDED_BY_HAND);
  const order = [...new Set(items.map((i) => i.sheetName.trim() || "BOQ"))];
  return { of, order };
}

const needsOf = (item: InventoryItem, sectionFor: Map<string, string>) =>
  item.byItem.filter((u) => u.required > 0).map((u) => ({ section: sectionFor.get(u.item.id) ?? OTHER, required: u.required }));

async function movesOf(projectId: string, materialId?: string): Promise<Move[]> {
  const rows = await prisma.stockMovement.findMany({
    where: { projectId, ...(materialId ? { materialId } : {}) },
    select: { materialId: true, type: true, quantity: true, date: true, createdAt: true },
  });
  return rows.map((r) => ({ materialId: r.materialId, type: r.type, quantity: r.quantity.toNumber(), day: dayOf(r) }));
}

/** GET /projects/:projectId/materials-tab: the list by section, the bar graph (12 months), and the totals */
export async function materialsOverview(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "materials.view");
  const [{ entries, needs, orders, items }, sections, moves] = await Promise.all([stockInputs(prisma, projectId), sectionsOfNeeds(projectId), movesOf(projectId)]);
  const ids = [...new Set([...entries.map((e) => e.materialId), ...needs.map((n) => n.materialId), ...orders.map((o) => o.materialId)])];
  const materials = await prisma.material.findMany({ where: { id: { in: ids } } });
  const stock = buildInventory(materials.map(toMaterialInfo), entries, needs, orders, items);
  const info = new Map(materials.map((m) => [m.id, m]));

  const list: ListMaterial[] = stock.map((s) => {
    const m = info.get(s.material.id)!;
    const where = sectionOf(needsOf(s, sections.of));
    const figures = moveFigures(moves.filter((mv) => mv.materialId === s.material.id));
    const minStock = m.minStock.toNumber();
    return {
      id: m.id,
      name: m.name,
      unit: m.unit,
      rate: m.rate.toNumber(),
      section: where.section,
      alsoIn: where.alsoIn,
      needed: s.required,
      inStock: s.onHand,
      issued: s.issued,
      received: figures.received,
      lastIssued: figures.lastIssued,
      low: minStock > 0 && s.onHand <= minStock,
    };
  });

  const months = lastMonths(dayKeyIn(new Date()));
  const rate = new Map(list.map((m) => [m.id, m.rate]));
  const all = monthly(moves, months, (id) => rate.get(id) ?? 0);
  const byMaterial = Object.fromEntries(list.map((m) => [m.id, monthly(moves.filter((mv) => mv.materialId === m.id), months, () => 1)]));
  return { months, chart: { all, byMaterial }, totals: totals(all, list), sections: groupBySection(list, sections.order) };
}

/** GET /projects/:projectId/materials-tab/:materialId: one material's numbers, graph, what needs it, and the log */
export async function materialDetail(userId: string, projectId: string, materialId: string) {
  await requirePermission(userId, projectId, "materials.view");
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) throw new HttpError(404, "Material not found");
  const [{ entries, needs, orders, items }, sections, moves, log] = await Promise.all([
    stockInputs(prisma, projectId, materialId),
    sectionsOfNeeds(projectId),
    movesOf(projectId, materialId),
    prisma.stockMovement.findMany({
      where: { projectId, materialId },
      include: { material: { select: { id: true, name: true, unit: true } }, boqItem: { select: { id: true, code: true, title: true } }, order: { select: { id: true, reference: true } }, createdBy: { select: { email: true, name: true } } },
      orderBy: [{ date: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 300,
    }),
  ]);
  const s = inventoryItemFor(toMaterialInfo(material), entries, needs, orders, items);
  const figures = moveFigures(moves);
  const months = lastMonths(dayKeyIn(new Date()));

  return {
    material: { id: material.id, name: material.name, unit: material.unit, rate: material.rate.toNumber(), minStock: material.minStock.toNumber() },
    needed: s.required,
    inStock: s.onHand,
    issued: s.issued,
    received: figures.received,
    lastIssued: figures.lastIssued,
    stillNeeded: s.stillNeeded,
    toOrder: s.toOrder,
    months,
    chart: monthly(moves, months, () => 1),
    needs: s.byItem
      .filter((u) => u.required > 0 || u.issued > 0)
      .map((u) => ({
        id: u.item.id,
        section: sections.of.get(u.item.id) ?? OTHER,
        label: u.item.id.startsWith("est:") ? (u.item.title === ADDED_BY_HAND ? "" : u.item.title) : [u.item.code, u.item.title].filter(Boolean).join(" "),
        estimateId: u.item.id.startsWith("est:") ? u.item.id.slice(4) : null,
        required: u.required,
        issued: u.issued,
      })),
    log: log.map((row) => ({
      ...movementDto(row),
      by: row.createdBy.name || row.createdBy.email,
      billUrl:
        row.billId && row.billVersion !== null && row.billFormat
          ? drawingUrls({ publicId: row.billId, version: row.billVersion, format: row.billFormat, kind: kindOf(row.billFormat) }).openUrl
          : null,
    })),
  };
}

/**
 * POST /projects/:projectId/materials-tab/moves: Received, Issued or Correct stock, by quantity and date.
 * Received may carry a vendor and a bill (photo or PDF). Stock can never go below zero.
 */
export async function quickMove(userId: string, projectId: string, input: QuickMoveBody, file?: Express.Multer.File) {
  await requirePermission(userId, projectId, MOVEMENT_PERMISSION[input.type]);
  const material = await prisma.material.findUnique({ where: { id: input.materialId } });
  if (!material) throw new HttpError(404, "Material not found");
  const today = dayKeyIn(new Date());
  if (input.date && input.date > today) throw new HttpError(400, "The date can't be in the future.");
  if ((input.type === "ADJUSTMENT_IN" || input.type === "ADJUSTMENT_OUT") && input.note.trim().length < 3) throw new HttpError(400, "Say why the stock is being corrected.");

  let bill: { billId: string; billVersion: number; billFormat: string } | null = null;
  if (file && input.type === "RECEIVED") {
    const detected = detectFileType(file.buffer);
    if (!detected || detected.kind === "cad") throw new HttpError(415, "The bill can be a photo (JPG, PNG, WebP) or a PDF.");
    if (detected.kind === "image" && file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Photos can be up to 10 MB.");
    const stored = await uploadDrawingFile(file.buffer, detected);
    bill = { billId: stored.publicId, billVersion: stored.version, billFormat: stored.format };
  }

  try {
    const row = await prisma.$transaction((tx) =>
      recordMovementIn(
        tx,
        userId,
        projectId,
        { materialId: material.id, type: input.type, quantity: input.quantity, boqItemId: null, orderId: null, note: input.note, date: input.date ?? today, vendorName: input.type === "RECEIVED" ? input.vendorName : "" },
        material,
        bill
      )
    );
    refreshAlertsSoon(projectId);
    return { movement: movementDto(row) };
  } catch (err) {
    if (bill) await deleteDrawingFile(bill.billId, kindOf(bill.billFormat)); // never leave an orphan bill behind
    throw err;
  }
}