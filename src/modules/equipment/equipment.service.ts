import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { deleteDrawingFile, drawingUrls, uploadDrawingFile } from "../../lib/cloudinary.js";
import { detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import {
  CATEGORIES,
  checkMove,
  lastCondition,
  onSiteSince,
  rateOn,
  stockByPlace,
  totalOf,
  useByPlace,
  YARD,
  type HireTerms,
  type Move,
  type MoveKind,
} from "./equipment.calc.js";
import type { CreateEquipment, HireChangeInput, MoveInput, UpdateEquipment } from "./equipment.schema.js";

/*
 * Phase 6: the equipment register. Every change of quantity is a move; "how many where" is always worked out from
 * the moves (equipment.calc.ts), so the numbers and their history can never disagree.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const num = (v: Prisma.Decimal | null) => (v === null ? null : v.toNumber());
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
const today = () => dayKeyIn(new Date());
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

const itemSelect = {
  id: true,
  serialNo: true,
  name: true,
  category: true,
  unit: true,
  code: true,
  ownership: true,
  hireRate: true,
  hirePer: true,
  supplier: true,
  serviceDue: true,
  notes: true,
  unitCost: true,
  marketValue: true,
  marketValueOn: true,
  purchasedOn: true,
  retired: true,
  updatedAt: true,
  billId: true,
  billVersion: true,
  billFormat: true,
  // Rate changes and one-off amounts: every hire figure below takes them into account
  hireChanges: { select: { kind: true, date: true, rate: true, amount: true, projectId: true } },
} satisfies Prisma.EquipmentSelect;
type ItemRow = Prisma.EquipmentGetPayload<{ select: typeof itemSelect }>;

const moveSelect = {
  id: true,
  kind: true,
  fromProjectId: true,
  toProjectId: true,
  quantity: true,
  date: true,
  condition: true,
  createdAt: true,
} satisfies Prisma.EquipmentMoveSelect;
type MoveRow = Prisma.EquipmentMoveGetPayload<{ select: typeof moveSelect }>;

const toMove = (m: MoveRow): Move => ({
  id: m.id,
  kind: m.kind as MoveKind,
  from: m.fromProjectId,
  to: m.toProjectId,
  qty: m.quantity.toNumber(),
  date: ymd(m.date),
  seq: m.createdAt.getTime(),
  condition: m.condition,
});

const termsOf = (i: ItemRow): HireTerms => ({
  ownership: i.ownership === "hired" ? "hired" : "owned",
  rate: num(i.hireRate),
  per: i.hirePer === "month" ? "month" : "day",
  rates: i.hireChanges.filter((c) => c.kind === "rate" && c.rate !== null).map((c) => ({ from: ymd(c.date), rate: c.rate!.toNumber() })),
  amounts: i.hireChanges
    .filter((c) => c.kind === "amount" && c.amount !== null && c.projectId)
    .map((c) => ({ date: ymd(c.date), place: c.projectId!, amount: c.amount!.toNumber() })),
});

/** Our running number as people read it: 7 → "EQ-0007" */
export const equipmentNo = (serialNo: number) => `EQ-${String(serialNo).padStart(4, "0")}`;

// The bill: a link to open it, and whether it is a photo or a PDF (both empty when there is none)
const kindOf = (format: string) => (format === "pdf" ? "pdf" : "image") as "pdf" | "image";
const billOf = (b: { billId: string | null; billVersion: number | null; billFormat: string | null }) => ({
  billUrl:
    b.billId && b.billVersion !== null && b.billFormat
      ? drawingUrls({ publicId: b.billId, version: b.billVersion, format: b.billFormat, kind: kindOf(b.billFormat) }).openUrl
      : null,
  billKind: b.billFormat ? kindOf(b.billFormat) : null,
});
const dropBill = (b: { billId: string | null; billFormat: string | null }) =>
  b.billId && b.billFormat ? deleteDrawingFile(b.billId, kindOf(b.billFormat)).catch(() => { }) : Promise.resolve();

const itemDto = (i: ItemRow) => ({
  id: i.id,
  serialNo: i.serialNo,
  number: equipmentNo(i.serialNo),
  name: i.name,
  category: i.category,
  unit: i.unit,
  code: i.code,
  ownership: i.ownership as "owned" | "hired",
  hireRate: num(i.hireRate),
  hirePer: i.hirePer as "day" | "month",
  /** The rate in force today, after any rate changes (hired items); the same as hireRate when there were none */
  rateNow: rateOn(termsOf(i), today()),
  supplier: i.supplier,
  serviceDue: i.serviceDue ? ymd(i.serviceDue) : null,
  notes: i.notes,
  unitCost: num(i.unitCost), // per unit
  marketValue: num(i.marketValue), // per unit
  marketValueOn: i.marketValueOn ? ymd(i.marketValueOn) : null,
  purchasedOn: i.purchasedOn ? ymd(i.purchasedOn) : null,
  retired: i.retired,
  updatedAt: i.updatedAt,
  ...billOf(i),
});

async function projectNames(ids: Iterable<string>) {
  const list = [...new Set([...ids].filter(Boolean))];
  if (!list.length) return new Map<string, string>();
  const rows = await prisma.project.findMany({ where: { id: { in: list } }, select: { id: true, title: true } });
  return new Map(rows.map((r) => [r.id, r.title]));
}

const placesOf = (at: Map<string, number>, names: Map<string, string>) => ({
  yard: at.get(YARD) ?? 0,
  sites: [...at]
    .filter(([p]) => p !== YARD)
    .map(([projectId, qty]) => ({ projectId, title: names.get(projectId) ?? "Removed project", qty }))
    .sort((a, b) => b.qty - a.qty),
});

/* ------------------------------------------- the register ------------------------------------------- */

/** GET /equipment: every item, how many there are and where; plus the projects equipment can be sent to */
export async function listEquipment(userId: string) {
  await requireCan(userId, "equipment.view");
  const [items, moves, projects] = await Promise.all([
    prisma.equipment.findMany({ where: { archivedAt: null }, select: itemSelect, orderBy: [{ retired: "asc" }, { serialNo: "asc" }] }),
    prisma.equipmentMove.findMany({ select: { ...moveSelect, equipmentId: true } }),
    prisma.project.findMany({ where: { status: "ONGOING" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
  const byItem = new Map<string, Move[]>();
  for (const m of moves) byItem.set(m.equipmentId, [...(byItem.get(m.equipmentId) ?? []), toMove(m)]);
  const names = await projectNames([...moves.flatMap((m) => [m.fromProjectId ?? "", m.toProjectId ?? ""]), ...projects.map((p) => p.id)]);

  // The number the next item will most likely get (shown on the Add form; the database gives the real one on saving)
  const nextNo = items.reduce((max, i) => Math.max(max, i.serialNo), 0) + 1;

  return {
    categories: CATEGORIES,
    projects,
    nextNumber: equipmentNo(nextNo),
    // Archived items: counted nowhere; restore one, or delete it for good
    archived: (
      await prisma.equipment.findMany({ where: { archivedAt: { not: null } }, select: { id: true, serialNo: true, name: true, unitCost: true, archivedAt: true }, orderBy: { archivedAt: "desc" } })
    ).map(archivedDto),
    items: items.map((i) => {
      const at = stockByPlace(byItem.get(i.id) ?? []);
      return { ...itemDto(i), total: totalOf(at), ...placesOf(at, names) };
    }),
  };
}

/** GET /equipment/:id: one item, where it is, what it has cost each site, and every move */
export async function getEquipment(userId: string, id: string) {
  await requireCan(userId, "equipment.view");
  const item = await prisma.equipment.findUnique({ where: { id }, select: { ...itemSelect, addedBy: { select: { name: true, email: true } }, createdAt: true } });
  if (!item) throw new HttpError(404, "Equipment not found");
  const rows = await prisma.equipmentMove.findMany({
    where: { equipmentId: id },
    select: { ...moveSelect, note: true, by: { select: { name: true, email: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const moves = rows.map(toMove);
  const changes = await prisma.equipmentHireChange.findMany({
    where: { equipmentId: id },
    select: { id: true, kind: true, date: true, rate: true, amount: true, projectId: true, note: true, addedBy: true, createdAt: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const names = await projectNames([...rows.flatMap((m) => [m.fromProjectId ?? "", m.toProjectId ?? ""]), ...changes.map((c) => c.projectId ?? "")]);
  const at = stockByPlace(moves);
  const day = today();
  const use = useByPlace(moves, termsOf(item), day);
  const month = useByPlace(moves, termsOf(item), day, { from: monthStart(day) });

  return {
    ...itemDto(item),
    addedBy: item.addedBy.name || item.addedBy.email,
    total: totalOf(at),
    ...placesOf(at, names),
    use: [...use]
      .map(([place, u]) => ({
        projectId: place === YARD ? null : place,
        title: place === YARD ? "Yard" : (names.get(place) ?? "Removed project"),
        unitDays: u.unitDays,
        charge: u.charge,
        chargeThisMonth: month.get(place)?.charge ?? 0,
      }))
      .sort((a, b) => b.charge - a.charge || b.unitDays - a.unitDays),
    /** Rate changes and one-off amounts, newest first */
    hireChanges: changes.map((c) => ({
      id: c.id,
      kind: c.kind as "rate" | "amount",
      date: ymd(c.date),
      rate: num(c.rate),
      amount: num(c.amount),
      site: c.projectId ? { projectId: c.projectId, title: names.get(c.projectId) ?? "Removed project" } : null,
      note: c.note,
      by: c.addedBy,
      createdAt: c.createdAt,
    })),
    history: rows.map((m) => ({
      id: m.id,
      kind: m.kind as MoveKind,
      from: m.fromProjectId ? { projectId: m.fromProjectId, title: names.get(m.fromProjectId) ?? "Removed project" } : null,
      to: m.toProjectId ? { projectId: m.toProjectId, title: names.get(m.toProjectId) ?? "Removed project" } : null,
      quantity: m.quantity.toNumber(),
      date: ymd(m.date),
      condition: m.condition,
      note: m.note,
      by: m.by.name || m.by.email,
      createdAt: m.createdAt,
    })),
  };
}

/* ------------------------------------------- one project ------------------------------------------- */

/** GET /projects/:id/equipment: what is at this site now, since when, and what it has cost here */
export async function projectEquipment(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "equipment.view");
  const touching = await prisma.equipmentMove.findMany({
    where: { OR: [{ toProjectId: projectId }, { fromProjectId: projectId }] },
    select: { equipmentId: true },
    distinct: ["equipmentId"],
  });
  const ids = touching.map((t) => t.equipmentId);
  const [items, moves] = await Promise.all([
    prisma.equipment.findMany({ where: { id: { in: ids }, archivedAt: null }, select: itemSelect }),
    prisma.equipmentMove.findMany({ where: { equipmentId: { in: ids } }, select: { ...moveSelect, equipmentId: true } }),
  ]);
  const byItem = new Map<string, Move[]>();
  for (const m of moves) byItem.set(m.equipmentId, [...(byItem.get(m.equipmentId) ?? []), toMove(m)]);
  const day = today();

  const rows = items.map((i) => {
    const list = byItem.get(i.id) ?? [];
    const here = stockByPlace(list).get(projectId) ?? 0;
    const use = useByPlace(list, termsOf(i), day).get(projectId);
    const month = useByPlace(list, termsOf(i), day, { from: monthStart(day) }).get(projectId);
    return {
      ...itemDto(i),
      here,
      since: onSiteSince(list, projectId),
      condition: lastCondition(list, projectId),
      unitDays: use?.unitDays ?? 0,
      hireSoFar: use?.charge ?? 0,
      hireThisMonth: month?.charge ?? 0,
    };
  });
  const now = rows.filter((r) => r.here > 0).sort((a, b) => a.name.localeCompare(b.name));
  const before = rows.filter((r) => r.here <= 0 && r.unitDays > 0).sort((a, b) => b.hireSoFar - a.hireSoFar);

  const archived = await prisma.equipment.findMany({
    where: { id: { in: ids }, archivedAt: { not: null } },
    select: { id: true, serialNo: true, name: true, unitCost: true, archivedAt: true },
    orderBy: { archivedAt: "desc" },
  });

  return {
    categories: CATEGORIES,
    items: now,
    /** Archived items that were at this site: counted nowhere until restored */
    archived: archived.map(archivedDto),
    /** Here earlier, gone now: kept so their hire charges still add up on this project */
    earlier: before.map((r) => ({ id: r.id, name: r.name, unit: r.unit, category: r.category, unitDays: r.unitDays, hireSoFar: r.hireSoFar, hireThisMonth: r.hireThisMonth })),
    totals: {
      items: now.length,
      hireSoFar: Math.round(rows.reduce((s, r) => s + r.hireSoFar, 0)),
      hireThisMonth: Math.round(rows.reduce((s, r) => s + r.hireThisMonth, 0)),
      serviceDue: now.filter((r) => r.serviceDue && r.serviceDue <= day).length,
    },
  };
}

/** The hub tile's line: how many items are here, and this month's hire */
/**
 * Hire charged to each project so far, the same figure as the Equipment section's "hire in all" (items here now and
 * earlier). For the Overview's spending and the project cards, many projects in one round of queries.
 */
export async function equipmentHireByProject(projectIds: string[]): Promise<Map<string, number>> {
  const out = new Map(projectIds.map((id) => [id, 0]));
  if (projectIds.length === 0) return out;
  const touching = await prisma.equipmentMove.findMany({
    where: { OR: [{ toProjectId: { in: projectIds } }, { fromProjectId: { in: projectIds } }] },
    select: { equipmentId: true },
    distinct: ["equipmentId"],
  });
  if (!touching.length) return out;
  const ids = touching.map((t) => t.equipmentId);
  const [items, moves] = await Promise.all([
    prisma.equipment.findMany({ where: { id: { in: ids }, archivedAt: null }, select: itemSelect }),
    prisma.equipmentMove.findMany({ where: { equipmentId: { in: ids } }, select: { ...moveSelect, equipmentId: true } }),
  ]);
  const byItem = new Map<string, Move[]>();
  for (const m of moves) byItem.set(m.equipmentId, [...(byItem.get(m.equipmentId) ?? []), toMove(m)]);
  const day = today();
  for (const i of items) {
    const use = useByPlace(byItem.get(i.id) ?? [], termsOf(i), day);
    for (const id of projectIds) out.set(id, (out.get(id) ?? 0) + (use.get(id)?.charge ?? 0));
  }
  for (const [id, v] of out) out.set(id, Math.round(v * 100) / 100);
  return out;
}

export async function equipmentHeadline(projectId: string) {
  const touching = await prisma.equipmentMove.findMany({ where: { OR: [{ toProjectId: projectId }, { fromProjectId: projectId }] }, select: { equipmentId: true }, distinct: ["equipmentId"] });
  if (!touching.length) return { items: 0, hireThisMonth: 0 };
  const ids = touching.map((t) => t.equipmentId);
  const [items, moves] = await Promise.all([
    prisma.equipment.findMany({ where: { id: { in: ids }, archivedAt: null }, select: itemSelect }),
    prisma.equipmentMove.findMany({ where: { equipmentId: { in: ids } }, select: { ...moveSelect, equipmentId: true } }),
  ]);
  const day = today();
  let count = 0;
  let hire = 0;
  for (const i of items) {
    const list = moves.filter((m) => m.equipmentId === i.id).map(toMove);
    if ((stockByPlace(list).get(projectId) ?? 0) > 0) count++;
    hire += useByPlace(list, termsOf(i), day, { from: monthStart(day) }).get(projectId)?.charge ?? 0;
  }
  return { items: count, hireThisMonth: Math.round(hire) };
}

/* ---------------------------------------------- changes ---------------------------------------------- */

async function assertProject(db: Db, id: string | null) {
  if (id && !(await db.project.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(400, "That project doesn't exist any more.");
}

/** Moves on one item are checked and saved one at a time, so two people can't both send the last 10 plates */
const serial = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10_000 };

export async function createEquipment(userId: string, input: CreateEquipment) {
  await requireCan(userId, "equipment.manage");
  if (input.date > today()) throw new HttpError(400, "The date can't be in the future.");
  return prisma.$transaction(async (tx) => {
    await assertProject(tx, input.to);
    const { quantity, to, date, serviceDue, purchasedOn, ...details } = input;
    const item = await tx.equipment.create({
      data: {
        ...details,
        serviceDue: serviceDue ? asDate(serviceDue) : null,
        purchasedOn: purchasedOn ? asDate(purchasedOn) : null,
        marketValueOn: details.marketValue !== null ? asDate(today()) : null, // valued today
        addedById: userId,
      },
      select: { id: true, serialNo: true },
    });
    await tx.equipmentMove.create({
      data: { equipmentId: item.id, kind: "add", toProjectId: to, quantity, date: asDate(date), byId: userId, note: "Added to the register" },
    });
    return { id: item.id, number: equipmentNo(item.serialNo) };
  });
}

export async function updateEquipment(userId: string, id: string, input: UpdateEquipment) {
  await requireCan(userId, "equipment.manage");
  const before = await prisma.equipment.findUnique({ where: { id }, select: itemSelect });
  if (!before) throw new HttpError(404, "Equipment not found");
  const { serviceDue, purchasedOn, ...rest } = input;
  await prisma.$transaction(async (tx) => {
    // A new market value is dated today; sending the same value again keeps its old date
    const valueChanged = rest.marketValue !== undefined && rest.marketValue !== num(before.marketValue);
    await tx.equipment.update({
      where: { id },
      data: {
        ...rest,
        ...(serviceDue !== undefined ? { serviceDue: serviceDue ? asDate(serviceDue) : null } : {}),
        ...(purchasedOn !== undefined ? { purchasedOn: purchasedOn ? asDate(purchasedOn) : null } : {}),
        ...(valueChanged ? { marketValueOn: rest.marketValue === null ? null : asDate(today()) } : {}),
      },
    });
  });
  return { id };
}

/**
 * DELETE /equipment/:id: remove an item added by mistake, with its moves and hire changes (they cascade). Its hire
 * stops counting on every project. Items that are worn out or sold should be written off instead, to keep the history.
 */
/** An archived item, as the Archived list shows it */
const archivedDto = (a: { id: string; serialNo: number; name: string; unitCost: { toNumber(): number } | null; archivedAt: Date | null }) => ({
  id: a.id,
  number: equipmentNo(a.serialNo),
  name: a.name,
  unitCost: a.unitCost?.toNumber() ?? null,
  archivedAt: a.archivedAt,
});

/** POST /equipment/:id/archive and …/restore: an archived item is hidden and counted nowhere until restored */
export async function archiveEquipment(userId: string, id: string, archive: boolean) {
  await requireCan(userId, "equipment.manage");
  const { count } = await prisma.equipment.updateMany({
    where: { id, archivedAt: archive ? null : { not: null } },
    data: { archivedAt: archive ? new Date() : null },
  });
  if (count === 0) throw new HttpError(404, archive ? "That equipment is no longer there." : "That equipment isn't archived.");
  return { ok: true };
}

/** DELETE /equipment/:id: for good, with its moves and hire changes; only an archived item */
export async function deleteEquipment(userId: string, id: string) {
  await requireCan(userId, "equipment.manage");
  const item = await prisma.equipment.findUnique({ where: { id }, select: { id: true, billId: true, billFormat: true, archivedAt: true } });
  if (!item) throw new HttpError(404, "That equipment was already deleted.");
  if (!item.archivedAt) throw new HttpError(409, "Archive the equipment first; only archived equipment can be deleted.");
  await prisma.equipment.delete({ where: { id } });
  await dropBill(item); // the file goes once the row is surely gone
  return { ok: true };
}

/** PUT /equipment/:id/bill: attach the item's bill (a photo or PDF); a new one replaces the old */
export async function setEquipmentBill(userId: string, id: string, file?: Express.Multer.File) {
  await requireCan(userId, "equipment.manage");
  if (!file) throw new HttpError(400, "Choose the bill: a photo (JPG, PNG) or a PDF.");
  const before = await prisma.equipment.findUnique({ where: { id }, select: { id: true, billId: true, billFormat: true } });
  if (!before) throw new HttpError(404, "That equipment is no longer there.");
  const detected = detectFileType(file.buffer);
  if (!detected || detected.kind === "cad") throw new HttpError(415, "The bill can be a photo (JPG, PNG, WebP) or a PDF.");
  if (detected.kind === "image" && file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Photos can be up to 10 MB.");
  const stored = await uploadDrawingFile(file.buffer, detected);
  await prisma.equipment.update({ where: { id }, data: { billId: stored.publicId, billVersion: stored.version, billFormat: stored.format } });
  await dropBill(before); // the old bill, if there was one
  return billOf({ billId: stored.publicId, billVersion: stored.version, billFormat: stored.format });
}

/** DELETE /equipment/:id/bill: take the bill off */
export async function removeEquipmentBill(userId: string, id: string) {
  await requireCan(userId, "equipment.manage");
  const before = await prisma.equipment.findUnique({ where: { id }, select: { id: true, billId: true, billFormat: true } });
  if (!before) throw new HttpError(404, "That equipment is no longer there.");
  await prisma.equipment.update({ where: { id }, data: { billId: null, billVersion: null, billFormat: null } });
  await dropBill(before);
  return { ok: true };
}

/** POST /equipment/:id/moves: bring more in, move between places, or write some off */
export async function addMove(userId: string, id: string, input: MoveInput) {
  await requireCan(userId, "equipment.manage");
  const move: Move = {
    kind: input.kind,
    from: input.kind === "add" ? null : input.from,
    to: input.kind === "write_off" ? null : input.to,
    qty: input.quantity,
    date: input.date,
  };

  const saved = await prisma.$transaction(async (tx) => {
    const item = await tx.equipment.findUnique({ where: { id }, select: { name: true, unit: true, archivedAt: true } });
    if (!item) throw new HttpError(404, "Equipment not found");
    if (item.archivedAt) throw new HttpError(409, "This equipment is archived. Restore it first.");
    await assertProject(tx, move.from);
    await assertProject(tx, move.to);
    const moves = (await tx.equipmentMove.findMany({ where: { equipmentId: id }, select: moveSelect })).map(toMove);

    const names = await projectNames([move.from ?? "", move.to ?? "", ...moves.flatMap((m) => [m.from ?? "", m.to ?? ""])]);
    const name = (p: string) => (p === YARD ? "the yard" : (names.get(p) ?? "that project"));
    const problem = checkMove(moves, move, today(), name, item.unit);
    if (problem) throw new HttpError(400, problem);

    const row = await tx.equipmentMove.create({
      data: {
        equipmentId: id,
        kind: move.kind,
        fromProjectId: move.from,
        toProjectId: move.to,
        quantity: move.qty,
        date: asDate(move.date),
        condition: input.condition,
        note: input.note,
        byId: userId,
      },
      select: { id: true },
    });
    // Using it again: it can't stay retired
    await tx.equipment.update({ where: { id }, data: { retired: false } });
    return row;
  }, serial);
  return saved;
}

/** DELETE /equipment/:id/moves/:moveId: undo the latest move (a slip of the finger), if nothing later depends on it */
export async function undoMove(userId: string, id: string, moveId: string) {
  await requireCan(userId, "equipment.manage");
  await prisma.$transaction(async (tx) => {
    const rows = await tx.equipmentMove.findMany({ where: { equipmentId: id }, select: { ...moveSelect, note: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
    const latest = rows[0];
    if (!latest || latest.id !== moveId) throw new HttpError(400, "Only the latest move can be undone. Record a move back instead.");
    if (rows.length === 1) throw new HttpError(400, "This is how the item was added. Write it off instead, or edit its details.");
    await tx.equipmentMove.delete({ where: { id: moveId } });
  }, serial);
  return { ok: true };
}

/* ------------------------------------------- hire changes ------------------------------------------- */

/**
 * POST /equipment/:id/hire-changes: a hired item's cost changed. Either a new rate from a date (every day from then on
 * is charged at it), or a one-off amount (+ extra, − credit) charged to one site. Hire figures everywhere follow.
 */
export async function addHireChange(userId: string, id: string, input: HireChangeInput) {
  await requireCan(userId, "equipment.manage");
  if (input.date > today()) throw new HttpError(400, "The date can't be in the future.");
  const item = await prisma.equipment.findUnique({ where: { id }, select: { ownership: true, archivedAt: true } });
  if (!item) throw new HttpError(404, "Equipment not found");
  if (item.archivedAt) throw new HttpError(409, "This equipment is archived. Restore it first.");
  if (item.ownership !== "hired") throw new HttpError(400, "Only hired equipment has a hire rate to change.");
  if (input.kind === "amount") await assertProject(prisma, input.projectId);
  const who = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });

  return prisma.equipmentHireChange.create({
    data:
      input.kind === "rate"
        ? { equipmentId: id, kind: "rate", date: asDate(input.date), rate: input.rate, note: input.note, addedBy: who?.name || who?.email || "Someone" }
        : { equipmentId: id, kind: "amount", date: asDate(input.date), amount: input.amount, projectId: input.projectId, note: input.note, addedBy: who?.name || who?.email || "Someone" },
    select: { id: true },
  });
}

/** DELETE /equipment/:id/hire-changes/:changeId: remove a rate change or amount logged by mistake */
export async function removeHireChange(userId: string, id: string, changeId: string) {
  await requireCan(userId, "equipment.manage");
  const row = await prisma.equipmentHireChange.findFirst({ where: { id: changeId, equipmentId: id }, select: { id: true } });
  if (!row) throw new HttpError(404, "That change was already removed.");
  await prisma.equipmentHireChange.delete({ where: { id: row.id } });
  return { ok: true };
}

/**
 * Equipment spend per project, matching the Equipment tab: for owned items, the pieces at that site × their cost each;
 * for hired items, the hire charged to that site so far. Written-off and moved-away pieces no longer count there.
 */
export async function equipmentSpendByProject(projectIds: string[]): Promise<Map<string, number>> {
  const out = new Map(projectIds.map((id) => [id, 0]));
  if (projectIds.length === 0) return out;
  const touching = await prisma.equipmentMove.findMany({
    where: { OR: [{ toProjectId: { in: projectIds } }, { fromProjectId: { in: projectIds } }] },
    select: { equipmentId: true },
    distinct: ["equipmentId"],
  });
  if (!touching.length) return out;
  const ids = touching.map((t) => t.equipmentId);
  const [items, moves] = await Promise.all([
    prisma.equipment.findMany({ where: { id: { in: ids }, archivedAt: null }, select: itemSelect }),
    prisma.equipmentMove.findMany({ where: { equipmentId: { in: ids } }, select: { ...moveSelect, equipmentId: true } }),
  ]);
  const byItem = new Map<string, Move[]>();
  for (const m of moves) byItem.set(m.equipmentId, [...(byItem.get(m.equipmentId) ?? []), toMove(m)]);
  const day = today();
  for (const i of items) {
    const list = byItem.get(i.id) ?? [];
    if (i.ownership === "hired") {
      const use = useByPlace(list, termsOf(i), day);
      for (const id of projectIds) out.set(id, (out.get(id) ?? 0) + (use.get(id)?.charge ?? 0));
    } else {
      const cost = i.unitCost?.toNumber() ?? 0;
      if (!cost) continue;
      const here = stockByPlace(list);
      for (const id of projectIds) out.set(id, (out.get(id) ?? 0) + (here.get(id) ?? 0) * cost);
    }
  }
  for (const [id, v] of out) out.set(id, Math.round(v * 100) / 100);
  return out;
}