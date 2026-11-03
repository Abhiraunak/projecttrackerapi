import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { getUserAccess, requirePermission } from "../../lib/projectAccess.js";
import { recordAudit } from "../audit/audit.service.js";
import { estimate, type EstimateMethod, type SteelRow, type VolumeRow } from "./estimates.calc.js";
import type { EstimateBody } from "./estimates.schema.js";

/*
 * Materials a project needs, added by hand (not from the BOQ). Seeing them needs "View materials"; adding, editing
 * or deleting needs "Plan materials" (requirements.create), the same as setting a BOQ item's materials.
 * A new material named here goes on the company's material list, which needs "Manage the material list".
 */

const include = { material: { select: { id: true, name: true, unit: true, category: true } }, addedBy: { select: { name: true, email: true } } } as const;
type Row = Prisma.MaterialEstimateGetPayload<{ include: typeof include }>;

const dto = (e: Row) => {
  const rows = (e.rows ?? null) as { steel?: SteelRow[]; volume?: VolumeRow[] } | null;
  return {
    id: e.id,
    material: e.material,
    title: e.title,
    method: e.method as EstimateMethod,
    steel: rows?.steel ?? [],
    volume: rows?.volume ?? [],
    wastagePercent: e.wastagePercent.toNumber(),
    quantity: e.quantity.toNumber(),
    notes: e.notes,
    addedBy: e.addedBy.name || e.addedBy.email,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
};

/** The material chosen, or the new one named (an existing name is reused instead of making a second) */
async function materialFor(userId: string, input: EstimateBody) {
  if (input.materialId) {
    const m = await prisma.material.findUnique({ where: { id: input.materialId }, select: { id: true, unit: true, name: true } });
    if (!m) throw new HttpError(404, "That material is no longer on the list.");
    return m;
  }
  const wanted = input.newMaterial!;
  const existing = await prisma.material.findFirst({ where: { name: { equals: wanted.name, mode: "insensitive" } }, select: { id: true, unit: true, name: true } });
  if (existing) return existing;
  const access = await getUserAccess(userId);
  if (!access.isAdmin && !access.permissions.includes("catalog.manage")) throw new HttpError(403, `${wanted.name} isn't on the material list yet, and adding to the list needs "Manage the material list". Ask someone who can, or choose a listed material.`);
  return prisma.material.create({ data: { name: wanted.name, unit: wanted.unit, category: wanted.category || "General", ownerId: userId }, select: { id: true, unit: true, name: true } });
}

/** Works the quantity out on the server (the screen's figure is never trusted) and keeps the rows as typed */
function worked(input: EstimateBody, unit: string) {
  const method = input.method;
  const result = estimate({ method, quantity: input.quantity ?? null, steel: input.steel, volume: input.volume, wastagePercent: input.wastagePercent }, unit);
  if (!result.ok) throw new HttpError(400, result.message);
  const rows: Prisma.InputJsonValue | undefined =
    method === "steel" ? { steel: input.steel ?? [] } : method === "volume" ? { volume: input.volume ?? [] } : undefined;
  return { method, rows, quantity: result.quantity };
}

/** GET /projects/:projectId/material-estimates: newest first */
export async function listEstimates(userId: string, projectId: string) {
  await requirePermission(userId, projectId, "materials.view");
  const rows = await prisma.materialEstimate.findMany({ where: { projectId }, include, orderBy: [{ createdAt: "desc" }] });
  return { items: rows.map(dto) };
}

export async function addEstimate(userId: string, projectId: string, input: EstimateBody) {
  await requirePermission(userId, projectId, "requirements.create");
  const material = await materialFor(userId, input);
  const w = worked(input, material.unit);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.materialEstimate.create({
      data: { projectId, materialId: material.id, title: input.title, method: w.method, rows: w.rows, wastagePercent: input.wastagePercent, quantity: w.quantity, notes: input.notes, addedById: userId },
      include,
    });
    await recordAudit(tx, {
      projectId,
      actorId: userId,
      action: "material_estimate.added",
      entityType: "requirement",
      entityId: created.id,
      summary: `Added ${w.quantity} ${material.unit} of ${material.name}${input.title ? ` for ${input.title}` : ""}`,
    });
    return created;
  });
  return { estimate: dto(row) };
}

export async function updateEstimate(userId: string, projectId: string, estimateId: string, input: EstimateBody) {
  await requirePermission(userId, projectId, "requirements.create");
  const before = await prisma.materialEstimate.findFirst({ where: { id: estimateId, projectId } });
  if (!before) throw new HttpError(404, "That entry was not found. It may have been deleted.");
  const material = await materialFor(userId, input);
  const w = worked(input, material.unit);
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.materialEstimate.update({
      where: { id: estimateId },
      data: { materialId: material.id, title: input.title, method: w.method, rows: w.rows ?? Prisma.DbNull /* a plain quantity keeps no rows */, wastagePercent: input.wastagePercent, quantity: w.quantity, notes: input.notes },
      include,
    });
    await recordAudit(tx, {
      projectId,
      actorId: userId,
      action: "material_estimate.updated",
      entityType: "requirement",
      entityId: estimateId,
      summary: `Changed ${material.name}${input.title ? ` for ${input.title}` : ""}: ${before.quantity.toNumber()} → ${w.quantity} ${material.unit}`,
      changes: { quantity: { from: before.quantity.toNumber(), to: w.quantity } },
    });
    return updated;
  });
  return { estimate: dto(row) };
}

export async function removeEstimate(userId: string, projectId: string, estimateId: string) {
  await requirePermission(userId, projectId, "requirements.create");
  const before = await prisma.materialEstimate.findFirst({ where: { id: estimateId, projectId }, include });
  if (!before) throw new HttpError(404, "That entry was not found. It may have been deleted.");
  await prisma.$transaction(async (tx) => {
    await tx.materialEstimate.delete({ where: { id: estimateId } });
    await recordAudit(tx, {
      projectId,
      actorId: userId,
      action: "material_estimate.deleted",
      entityType: "requirement",
      entityId: estimateId,
      summary: `Removed ${before.quantity.toNumber()} ${before.material.unit} of ${before.material.name}${before.title ? ` for ${before.title}` : ""}`,
    });
  });
  return { ok: true };
}