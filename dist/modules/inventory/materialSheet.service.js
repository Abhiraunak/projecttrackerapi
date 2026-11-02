import { prisma } from "../../lib/prisma.js";
import { requirePermission } from "../../lib/projectAccess.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { stockInputs } from "./inventory.service.js";
import { toMaterialInfo } from "./inventory.mapper.js";
import { buildInventory } from "./stock.js";
import { costInputs } from "./cost.service.js";
import { materialBook } from "./materialSheet.calc.js";
const day = (d) => d.toISOString().slice(0, 10);
/**
 * GET /projects/:id/materials: the tiles and every tile's sheet in one response.
 * A project has tens of materials and a few hundred orders at most, so sending all sheets at once is small,
 * and tapping a tile then opens its sheet with no further request.
 */
export async function projectMaterials(userId, projectId) {
    await requirePermission(userId, projectId, "materials.view");
    const [{ entries, needs, orders, items }, costOf, orderRows] = await Promise.all([
        stockInputs(prisma, projectId),
        costInputs([projectId]),
        prisma.materialOrder.findMany({
            where: { projectId },
            select: { id: true, materialId: true, quantity: true, receivedQty: true, rate: true, expectedDelivery: true, reference: true, createdAt: true, vendor: { select: { name: true } } },
        }),
    ]);
    const ids = [...new Set([...entries.map((e) => e.materialId), ...needs.map((n) => n.materialId), ...orders.map((o) => o.materialId)])];
    const materials = await prisma.material.findMany({ where: { id: { in: ids } } });
    return materialBook(buildInventory(materials.map(toMaterialInfo), entries, needs, orders, items), costOf(projectId).items, orderRows.map((o) => ({
        id: o.id,
        materialId: o.materialId,
        vendor: o.vendor?.name ?? null,
        quantity: o.quantity.toNumber(),
        receivedQty: o.receivedQty.toNumber(),
        rate: o.rate.toNumber(),
        expectedDelivery: o.expectedDelivery ? day(o.expectedDelivery) : null,
        reference: o.reference,
        createdAt: day(o.createdAt),
    })), dayKeyIn(new Date()));
}
//# sourceMappingURL=materialSheet.service.js.map