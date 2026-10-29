import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan } from "../../lib/projectAccess.js";
import { refreshAlertsForMaterial } from "../alerts/alerts.service.js";
import { STARTER_MATERIALS } from "./catalog.defaults.js";
import { materialDto, vendorDto } from "./catalog.mapper.js";
/**
 * One catalog for the whole company: everyone picks from the same materials and vendors.
 * (The ownerId column just records who added an item.)
 */
/** First use only: the company gets the starter materials. Safe to call repeatedly. */
async function ensureStarterMaterials(addedBy) {
    if ((await prisma.material.count()) > 0)
        return;
    await prisma.material.createMany({ data: STARTER_MATERIALS.map((material) => ({ ...material, ownerId: addedBy })), skipDuplicates: true });
}
const insensitive = (name) => ({ equals: name, mode: "insensitive" });
async function assertMaterialNameFree(name, exceptId) {
    if (await prisma.material.findFirst({ where: { name: insensitive(name), ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } })) {
        throw new HttpError(409, "There is already a material with that name.");
    }
}
async function assertVendorNameFree(name, exceptId) {
    if (await prisma.vendor.findFirst({ where: { name: insensitive(name), ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } })) {
        throw new HttpError(409, "There is already a vendor with that name.");
    }
}
export async function getCatalog(userId) {
    await requireCan(userId, "materials.view");
    await ensureStarterMaterials(userId);
    const [materials, vendors] = await prisma.$transaction([
        prisma.material.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
        prisma.vendor.findMany({ orderBy: { name: "asc" } }),
    ]);
    return { materials: materials.map(materialDto), vendors: vendors.map(vendorDto) };
}
export async function createMaterial(userId, input) {
    await requireCan(userId, "catalog.manage");
    await assertMaterialNameFree(input.name);
    return materialDto(await prisma.material.create({ data: { ...input, ownerId: userId } }));
}
/**
 * Name, unit, category, minimum stock and standard rate. Changing the unit of a material already in use
 * would change the meaning of every quantity recorded for it, so that is refused.
 */
export async function updateMaterial(userId, id, input) {
    await requireCan(userId, "catalog.manage");
    const current = await prisma.material.findUnique({ where: { id } });
    if (!current)
        throw new HttpError(404, "Material not found");
    await assertMaterialNameFree(input.name, id);
    if (current.unit !== input.unit) {
        const used = await prisma.stockMovement.count({ where: { materialId: id } }) + (await prisma.materialOrder.count({ where: { materialId: id } }));
        if (used > 0)
            throw new HttpError(409, `${current.name} already has stock or orders in ${current.unit}, so its unit can't change. Add a new material instead.`);
    }
    const updated = await prisma.material.update({ where: { id }, data: input });
    // A new minimum can open or close "low stock" alerts on every project that uses it
    if (current.minStock.toNumber() !== input.minStock)
        refreshAlertsForMaterial(id);
    return materialDto(updated);
}
export async function createVendor(userId, input) {
    await requireCan(userId, "catalog.manage");
    await assertVendorNameFree(input.name);
    return vendorDto(await prisma.vendor.create({ data: { ...input, ownerId: userId } }));
}
export async function updateVendor(userId, id, input) {
    await requireCan(userId, "catalog.manage");
    if (!(await prisma.vendor.findUnique({ where: { id }, select: { id: true } })))
        throw new HttpError(404, "Vendor not found");
    await assertVendorNameFree(input.name, id);
    return vendorDto(await prisma.vendor.update({ where: { id }, data: input }));
}
/** A vendor no order uses can be deleted; one with orders stays, so past orders keep their vendor */
export async function deleteVendor(userId, id) {
    await requireCan(userId, "catalog.manage");
    const orders = await prisma.materialOrder.count({ where: { vendorId: id } });
    if (orders > 0)
        throw new HttpError(409, `This vendor is on ${orders} ${orders === 1 ? "order" : "orders"}, so it can't be deleted.`);
    const gone = await prisma.vendor.deleteMany({ where: { id } });
    if (gone.count === 0)
        throw new HttpError(404, "Vendor not found");
}
//# sourceMappingURL=catalog.service.js.map