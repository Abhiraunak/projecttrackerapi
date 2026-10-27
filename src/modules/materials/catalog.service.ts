import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan } from "../../lib/projectAccess.js";
import { STARTER_MATERIALS } from "./catalog.defaults.js";
import { materialDto, vendorDto } from "./catalog.mapper.js";
import type { MaterialBody, VendorBody } from "./catalog.schema.js";

/**
 * One catalog for the whole company: everyone picks from the same materials and vendors.
 * (The ownerId column now just records who added an item.)
 */

/** First use only: the company gets the starter materials. Safe to call repeatedly. */
async function ensureStarterMaterials(addedBy: string) {
  if ((await prisma.material.count()) > 0) return;
  await prisma.material.createMany({
    data: STARTER_MATERIALS.map((material) => ({ ...material, ownerId: addedBy })),
    skipDuplicates: true,
  });
}

const nameTaken = async (table: "material" | "vendor", name: string) => {
  const where = { name: { equals: name, mode: "insensitive" as const } };
  return table === "material" ? !!(await prisma.material.findFirst({ where })) : !!(await prisma.vendor.findFirst({ where }));
};

export async function getCatalog(userId: string) {
  await requireCan(userId, "materials.view");
  await ensureStarterMaterials(userId);
  const [materials, vendors] = await prisma.$transaction([
    prisma.material.findMany({ orderBy: { name: "asc" } }),
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
  ]);
  return { materials: materials.map(materialDto), vendors: vendors.map(vendorDto) };
}

export async function createMaterial(userId: string, input: MaterialBody) {
  await requireCan(userId, "catalog.manage");
  if (await nameTaken("material", input.name)) throw new HttpError(409, "There is already a material with that name.");
  return materialDto(await prisma.material.create({ data: { ...input, ownerId: userId } }));
}

export async function createVendor(userId: string, input: VendorBody) {
  await requireCan(userId, "catalog.manage");
  if (await nameTaken("vendor", input.name)) throw new HttpError(409, "There is already a vendor with that name.");
  return vendorDto(await prisma.vendor.create({ data: { ...input, ownerId: userId } }));
}
