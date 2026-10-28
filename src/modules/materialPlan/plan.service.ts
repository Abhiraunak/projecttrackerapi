import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { refreshAlertsSoon } from "../alerts/alerts.service.js";
import type { BoqDocument } from "../boqs/boq.calc.js";
import { boqOutline, boqParts, pickParts, planSync, requiredQty, suggestRecipe, type BoqPartRow, type ExistingItem, type Recipe, type SyncPlan } from "./plan.js";
import { RECIPE_MATERIALS, STARTER_RECIPES } from "./recipes.defaults.js";
import type { ImportBody, ItemMaterialsBody, RecipeBody } from "./plan.schema.js";

type Db = Prisma.TransactionClient | typeof prisma;
const num = (d: Prisma.Decimal | number) => (typeof d === "number" ? d : d.toNumber());

/* -------------------------------- recipes --------------------------------- */

const recipeInclude = { lines: { include: { material: { select: { id: true, name: true, unit: true } } }, orderBy: { position: "asc" } } } as const;
type RecipeRow = Prisma.MaterialRecipeGetPayload<{ include: typeof recipeInclude }>;

const recipeDto = (r: RecipeRow) => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  match: r.match as string[][],
  lines: r.lines.map((l) => ({ materialId: l.materialId, material: l.material, perUnit: num(l.perUnit), wastagePercent: num(l.wastagePercent) })),
});

const toRecipe = (r: RecipeRow): Recipe => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  match: r.match as string[][],
  lines: r.lines.map((l) => ({ materialId: l.materialId, perUnit: num(l.perUnit), wastagePercent: num(l.wastagePercent) })),
});

/** A material by name (any case), created if missing, for the starter recipes */
async function materialByName(db: Db, userId: string, m: (typeof RECIPE_MATERIALS)[number]) {
  const found = await db.material.findFirst({ where: { name: { equals: m.name, mode: "insensitive" } }, select: { id: true } });
  if (found) return found.id;
  const created = await db.material.create({ data: { ...m, ownerId: userId }, select: { id: true } });
  return created.id;
}

/** First use only: the company gets the starter recipes (and the materials they need). Safe to call repeatedly. */
async function ensureStarterRecipes(userId: string) {
  if ((await prisma.materialRecipe.count()) > 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('starter-recipes'))`;
    if ((await tx.materialRecipe.count()) > 0) return; // someone else seeded them meanwhile
    const ids = new Map<string, string>();
    for (const m of RECIPE_MATERIALS) ids.set(m.name, await materialByName(tx, userId, m));
    for (const r of STARTER_RECIPES) {
      await tx.materialRecipe.create({
        data: {
          name: r.name,
          unit: r.unit,
          match: r.match,
          lines: { create: r.lines.map((l, position) => ({ materialId: ids.get(l.material)!, perUnit: l.perUnit, wastagePercent: l.wastagePercent, position })) },
        },
      });
    }
  });
}

async function loadRecipes(userId: string): Promise<RecipeRow[]> {
  await ensureStarterRecipes(userId);
  return prisma.materialRecipe.findMany({ include: recipeInclude, orderBy: { name: "asc" } });
}

export async function listRecipes(userId: string) {
  await requireCan(userId, "materials.view");
  return (await loadRecipes(userId)).map(recipeDto);
}

async function assertMaterialsExist(ids: string[]) {
  if (ids.length === 0) return;
  const found = await prisma.material.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new HttpError(400, "One of the materials could not be found.");
}

const recipeData = (body: RecipeBody) => ({
  name: body.name,
  unit: body.unit,
  match: body.match,
  lines: { create: body.lines.map((l, position) => ({ materialId: l.materialId, perUnit: l.perUnit, wastagePercent: l.wastagePercent, position })) },
});

export async function createRecipe(userId: string, body: RecipeBody) {
  await requireCan(userId, "catalog.manage");
  await assertMaterialsExist(body.lines.map((l) => l.materialId));
  if (await prisma.materialRecipe.findFirst({ where: { name: { equals: body.name, mode: "insensitive" } } })) {
    throw new HttpError(409, "There is already a recipe with that name.");
  }
  return recipeDto(await prisma.materialRecipe.create({ data: recipeData(body), include: recipeInclude }));
}

export async function updateRecipe(userId: string, id: string, body: RecipeBody) {
  await requireCan(userId, "catalog.manage");
  await assertMaterialsExist(body.lines.map((l) => l.materialId));
  const clash = await prisma.materialRecipe.findFirst({ where: { name: { equals: body.name, mode: "insensitive" }, NOT: { id } } });
  if (clash) throw new HttpError(409, "There is already a recipe with that name.");
  if (!(await prisma.materialRecipe.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, "Recipe not found");
  // Changing a recipe never changes items it filled in before: their materials are their own copy
  const { lines, ...rest } = recipeData(body);
  const row = await prisma.materialRecipe.update({ where: { id }, data: { ...rest, lines: { deleteMany: {}, ...lines } }, include: recipeInclude });
  return recipeDto(row);
}

export async function deleteRecipe(userId: string, id: string) {
  await requireCan(userId, "catalog.manage");
  const gone = await prisma.materialRecipe.deleteMany({ where: { id } });
  if (gone.count === 0) throw new HttpError(404, "Recipe not found");
}

/* ------------------------------ the project plan --------------------------- */

const itemInclude = {
  boq: { select: { id: true, title: true, subtitle: true } },
  materials: { include: { material: { select: { id: true, name: true, unit: true } } }, orderBy: { position: "asc" } },
} as const;
type ItemRow = Prisma.BoqItemGetPayload<{ include: typeof itemInclude }>;

export const itemDto = (row: ItemRow) => {
  const quantity = num(row.quantity);
  return {
    id: row.id,
    boq: row.boq,
    sheetName: row.sheetName,
    code: row.code,
    title: row.title,
    unit: row.unit,
    quantity,
    active: row.active,
    noMaterials: row.noMaterials,
    suggested: row.suggested,
    recipeName: row.recipeName,
    materials: row.materials.map((m) => {
      const line = { perUnit: num(m.perUnit), wastagePercent: num(m.wastagePercent) };
      return { materialId: m.materialId, material: m.material, ...line, required: row.active ? requiredQty(quantity, line) : 0 };
    }),
  };
};

const toExisting = (row: { id: string; boqId: string | null; partKey: string; code: string; title: string; unit: string; quantity: Prisma.Decimal; active: boolean }): ExistingItem => ({
  id: row.id,
  boqId: row.boqId,
  partKey: row.partKey,
  code: row.code,
  title: row.title,
  unit: row.unit,
  quantity: num(row.quantity),
  active: row.active,
});

/** The project's BOQs and what they say now, as BOQ items */
async function currentParts(db: Db, projectId: string) {
  const boqs = await db.boq.findMany({
    where: { projectId },
    select: { id: true, title: true, subtitle: true, status: true, updatedAt: true, document: true },
    orderBy: { createdAt: "asc" },
  });
  const parts: BoqPartRow[] = [];
  for (const boq of boqs) parts.push(...boqParts(boq.id, boq.document as unknown as BoqDocument, parts.length));
  return { boqs: boqs.map(({ document: _d, ...b }) => b), parts };
}

async function computeSync(db: Db, projectId: string) {
  const [{ boqs, parts }, existing] = await Promise.all([
    currentParts(db, projectId),
    db.boqItem.findMany({ where: { projectId }, select: { id: true, boqId: true, partKey: true, code: true, title: true, unit: true, quantity: true, active: true } }),
  ]);
  return { boqs, parts, plan: planSync(existing.map(toExisting), parts) };
}

/** notImported: priced parts of the linked BOQs that are not in the plan (they come in through Import from BOQ) */
const counts = (plan: SyncPlan) => ({ notImported: plan.added.length, changed: plan.changed.length, removed: plan.removed.length, unchanged: plan.unchanged });

/** Everything the Materials screen shows: the project's BOQs, its items with their materials, and whether a sync is due */
export async function getPlan(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "materials.view");
  const [{ boqs, plan }, rows] = await Promise.all([
    computeSync(prisma, projectId),
    prisma.boqItem.findMany({ where: { projectId }, include: itemInclude, orderBy: [{ active: "desc" }, { position: "asc" }] }),
  ]);
  const items = rows.map(itemDto);
  const active = items.filter((i) => i.active);
  return {
    boqs,
    items,
    sync: counts(plan),
    summary: {
      items: active.length,
      withMaterials: active.filter((i) => i.materials.length > 0).length,
      labourOnly: active.filter((i) => i.noMaterials).length,
      toReview: active.filter((i) => i.suggested || (i.materials.length === 0 && !i.noMaterials)).length,
    },
  };
}

/** What a sync would do, in words people can check before applying it */
export async function previewSync(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "materials.view");
  const [{ boqs, plan }, issuedRows] = await Promise.all([
    computeSync(prisma, projectId),
    prisma.stockMovement.groupBy({ by: ["boqItemId"], where: { projectId, boqItemId: { not: null } }, _count: { _all: true } }),
  ]);
  const withStock = new Set(issuedRows.map((r) => r.boqItemId));

  return {
    boqs,
    ...counts(plan),
    changedItems: plan.changed.map(({ item, part, fields }) => ({
      id: item.id,
      code: part.code,
      title: part.title,
      fields,
      from: { quantity: item.quantity, unit: item.unit },
      to: { quantity: part.quantity, unit: part.unit },
    })),
    removedItems: plan.removed.map((item) => ({ id: item.id, code: item.code, title: item.title, hasStock: withStock.has(item.id) })),
  };
}

/** A BOQ part joins the plan with the best-fitting recipe's materials, marked "suggested" so someone checks them */
async function createItem(tx: Prisma.TransactionClient, projectId: string, part: BoqPartRow, recipes: Recipe[], now: Date) {
  const recipe = suggestRecipe(part, recipes);
  await tx.boqItem.create({
    data: {
      projectId,
      boqId: part.boqId,
      partKey: part.partKey,
      sheetName: part.sheetName,
      code: part.code,
      title: part.title,
      matchText: part.matchText,
      contextText: part.contextText,
      unit: part.unit,
      quantity: part.quantity,
      position: part.position,
      suggested: !!recipe,
      recipeName: recipe?.name ?? "",
      syncedAt: now,
      materials: recipe
        ? { create: recipe.lines.map((l, position) => ({ materialId: l.materialId, perUnit: l.perUnit, wastagePercent: l.wastagePercent, position })) }
        : undefined,
    },
  });
}

/** An item already in the plan takes the BOQ's current quantity, unit and wording */
const updateFromPart = (tx: Prisma.TransactionClient, itemId: string, part: BoqPartRow, now: Date) =>
  tx.boqItem.update({
    where: { id: itemId },
    data: { code: part.code, title: part.title, matchText: part.matchText, contextText: part.contextText, unit: part.unit, quantity: part.quantity, position: part.position, sheetName: part.sheetName, active: true, syncedAt: now },
  });

/**
 * Brings the items already in the plan in line with the BOQs: new quantities, units and wording; items that left the
 * BOQ are marked removed, never deleted, so stock issued to them keeps its history. New BOQ items are not added here:
 * they come in through Import from BOQ. Stock received and issued is never touched.
 */
export async function applySync(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "requirements.create");

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`material-plan:${projectId}`}))`;
      const { plan } = await computeSync(tx, projectId);
      const now = new Date();

      for (const { item, part } of plan.changed) await updateFromPart(tx, item.id, part, now);
      if (plan.removed.length) {
        await tx.boqItem.updateMany({ where: { id: { in: plan.removed.map((i) => i.id) } }, data: { active: false, syncedAt: now } });
      }
      const c = counts(plan);
      if (c.changed + c.removed > 0) {
        await recordAudit(tx, {
          projectId,
          actorId: userId,
          action: "materials.synced",
          entityType: "requirement",
          entityId: null,
          summary: `Synced materials from the BOQ: ${c.changed} changed, ${c.removed} removed`,
        });
      }
      return c;
    },
    { timeout: 30_000 }
  );

  refreshAlertsSoon(projectId); // new needs can mean new shortages
  return { applied: result, plan: await getPlan(userId, projectId) };
}

/** Sets one item's materials (from a recipe, typed by hand, or "labour only"). Clears the "suggested" mark. */
export async function saveItemMaterials(userId: string, itemId: string, body: ItemMaterialsBody) {
  const item = await prisma.boqItem.findUnique({ where: { id: itemId }, select: { id: true, projectId: true, code: true, title: true } });
  if (!item) throw new HttpError(404, "BOQ item not found");
  await requirePermission(userId, item.projectId, "requirements.create");
  const lines = body.noMaterials ? [] : body.lines;
  await assertMaterialsExist(lines.map((l) => l.materialId));

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.boqItem.update({
      where: { id: itemId },
      data: {
        noMaterials: body.noMaterials,
        suggested: false,
        recipeName: body.noMaterials ? "" : body.recipeName,
        materials: { deleteMany: {}, create: lines.map((l, position) => ({ materialId: l.materialId, perUnit: l.perUnit, wastagePercent: l.wastagePercent, position })) },
      },
      include: itemInclude,
    });
    await recordAudit(tx, {
      projectId: item.projectId,
      actorId: userId,
      action: "materials.item_updated",
      entityType: "requirement",
      entityId: itemId,
      summary: body.noMaterials
        ? `Marked "${item.code} ${item.title}" as labour only`
        : `Set ${lines.length} ${lines.length === 1 ? "material" : "materials"} for "${item.code} ${item.title}"${body.recipeName ? ` (${body.recipeName})` : ""}`,
    });
    return updated;
  });
  refreshAlertsSoon(item.projectId);
  return itemDto(row);
}

/* ------------------------------ import from BOQ ---------------------------- */

const MAX_IMPORT_BOQS = 300;

/**
 * Every BOQ the company has, for "Import from BOQ": this project's BOQs first, then those with no project, then the
 * ones that belong to another project (shown, but they can't be imported here: their items count in that project).
 */
export async function listImportableBoqs(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "requirements.create");
  const [boqs, imported] = await Promise.all([
    prisma.boq.findMany({
      select: { id: true, title: true, subtitle: true, boqNumber: true, status: true, itemCount: true, updatedAt: true, project: { select: { id: true, title: true } } },
      orderBy: { updatedAt: "desc" },
      take: MAX_IMPORT_BOQS,
    }),
    prisma.boqItem.groupBy({ by: ["boqId"], where: { projectId, active: true, boqId: { not: null } }, _count: { _all: true } }),
  ]);
  const importedBy = new Map(imported.map((r) => [r.boqId, r._count._all]));
  const rank = (b: { project: { id: string } | null }) => (b.project?.id === projectId ? 0 : b.project ? 2 : 1);
  return {
    boqs: boqs
      .map((b) => ({
        ...b,
        updatedAt: b.updatedAt.toISOString(),
        /** this: linked to this project · free: no project yet (importing links it here) · other: another project's */
        link: (b.project?.id === projectId ? "this" : b.project ? "other" : "free") as "this" | "free" | "other",
        importedCount: importedBy.get(b.id) ?? 0,
      }))
      .sort((a, b) => rank(a) - rank(b)),
  };
}

async function findBoqForImport(db: Db, boqId: string) {
  const boq = await db.boq.findUnique({
    where: { id: boqId },
    select: { id: true, title: true, subtitle: true, status: true, projectId: true, document: true, project: { select: { id: true, title: true } } },
  });
  if (!boq) throw new HttpError(404, "BOQ not found");
  return boq;
}

const otherProjectError = (title: string) =>
  new HttpError(409, `This BOQ belongs to the project "${title}", so its items are counted there. To use it here, open the BOQ and change its project first.`);

/** One BOQ as sheets › sections › items › parts, each part marked as in the plan, removed from it, or new */
export async function getImportOutline(userId: string, projectId: string, boqId: string) {
  await requirePermission(userId, projectId, "requirements.create");
  const [boq, existing, recipes] = await Promise.all([
    findBoqForImport(prisma, boqId),
    prisma.boqItem.findMany({ where: { projectId, boqId }, select: { partKey: true, active: true } }),
    loadRecipes(userId),
  ]);
  const state = new Map(existing.map((e) => [e.partKey, e.active ? "in" : "removed"] as const));
  const list = recipes.map(toRecipe);
  const sheets = boqOutline(boq.id, boq.document as unknown as BoqDocument).map((sheet) => ({
    name: sheet.name,
    sections: sheet.sections.map((section) => ({
      code: section.code,
      title: section.title,
      items: section.items.map((item) => ({
        code: item.code,
        description: item.description,
        parts: item.parts.map((p) => ({
          partKey: p.partKey,
          code: p.code,
          title: p.title,
          unit: p.unit,
          quantity: p.quantity,
          state: (state.get(p.partKey) ?? "new") as "new" | "in" | "removed",
          suggestion: suggestRecipe(p, list)?.name ?? null,
        })),
      })),
    })),
  }));
  const { document: _d, ...info } = boq;
  return { boq: { ...info, link: boq.projectId === projectId ? "this" : boq.projectId ? "other" : "free" }, sheets };
}

/**
 * Adds the ticked parts of one BOQ to the project's plan, each with its best-fitting recipe ("suggested: check").
 * Ticked parts that were removed earlier come back. A BOQ with no project is linked to this one, so later syncs keep
 * the imported items up to date; a BOQ that belongs to another project is refused.
 */
export async function importFromBoq(userId: string, projectId: string, body: ImportBody) {
  await requirePermission(userId, projectId, "requirements.create");
  const recipes = (await loadRecipes(userId)).map(toRecipe);

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`material-plan:${projectId}`}))`;
      const boq = await findBoqForImport(tx, body.boqId);
      if (boq.projectId && boq.projectId !== projectId) throw otherProjectError(boq.project?.title ?? "another project");

      let linked = false;
      if (!boq.projectId) {
        await tx.boq.update({ where: { id: boq.id }, data: { projectId } });
        linked = true;
      }

      // Positions follow the project's BOQs in order, so the plan lists items the way the BOQs do
      const [{ parts }, rows] = await Promise.all([
        currentParts(tx, projectId),
        tx.boqItem.findMany({ where: { projectId }, select: { id: true, boqId: true, partKey: true, code: true, title: true, unit: true, quantity: true, active: true } }),
      ]);
      const existing = rows.map(toExisting);
      const pick = pickParts(parts, existing, boq.id, body.partKeys);
      const now = new Date();

      for (const part of pick.create) await createItem(tx, projectId, part, recipes, now);
      for (const { item, part } of pick.restore) await updateFromPart(tx, item.id, part, now);

      const added = pick.create.length + pick.restore.length;
      if (added > 0 || linked) {
        const title = boq.title || "Untitled BOQ";
        await recordAudit(tx, {
          projectId,
          actorId: userId,
          action: "materials.imported",
          entityType: "requirement",
          entityId: null,
          summary: `Imported ${added} ${added === 1 ? "item" : "items"} from BOQ "${title}"${linked ? " (and linked the BOQ to this project)" : ""}`,
        });
      }
      return { added: pick.create.length, restored: pick.restore.length, already: pick.already, unknown: pick.unknown, linked };
    },
    { timeout: 30_000 }
  );

  if (result.added + result.restored > 0) refreshAlertsSoon(projectId);
  return { imported: result, plan: await getPlan(userId, projectId) };
}
