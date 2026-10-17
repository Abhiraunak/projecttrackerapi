import { HttpError } from "../../lib/error.js";
import { prisma } from "../../lib/prisma.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { STARTER_MATERIALS } from "./catalog.defaults.js";
import { materialDto, vendorDto } from "./catalog.mapper.js";
/** First use only: give the account the starter materials. Safe to call repeatedly. */
async function ensureStarterMaterials(ownerId) {
    if ((await prisma.material.count({ where: { ownerId } })) > 0)
        return;
    await prisma.material.createMany({
        data: STARTER_MATERIALS.map((material) => ({ ...material, ownerId })),
        skipDuplicates: true,
    });
}
export async function getCatalog(ownerId) {
    await ensureStarterMaterials(ownerId);
    const [materials, vendors] = await prisma.$transaction([
        prisma.material.findMany({ where: { ownerId }, orderBy: { name: "asc" } }),
        prisma.vendor.findMany({ where: { ownerId }, orderBy: { name: "asc" } }),
    ]);
    return { materials: materials.map(materialDto), vendors: vendors.map(vendorDto) };
}
export async function createMaterial(ownerId, input) {
    try {
        return materialDto(await prisma.material.create({ data: { ...input, ownerId } }));
    }
    catch (error) {
        if (isUniqueViolation(error))
            throw new HttpError(409, "You already have a material with that name.");
        throw error;
    }
}
export async function createVendor(ownerId, input) {
    try {
        return vendorDto(await prisma.vendor.create({ data: { ...input, ownerId } }));
    }
    catch (error) {
        if (isUniqueViolation(error))
            throw new HttpError(409, "You already have a vendor with that name.");
        throw error;
    }
}
//# sourceMappingURL=catalog.service.js.map