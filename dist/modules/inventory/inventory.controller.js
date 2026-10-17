import { getInventory, listMovements, recordMovement } from "./inventory.service.js";
import { movementsQuerySchema } from "./inventory.schema.js";
const ownerId = (req) => req.user.sub;
export async function inventory(req, res) {
    res.json({ items: await getInventory(ownerId(req), req.params.projectId) });
}
export async function movements(req, res) {
    const query = movementsQuerySchema.parse(req.query);
    res.json(await listMovements(ownerId(req), req.params.projectId, query));
}
export async function record(req, res) {
    const movement = await recordMovement(ownerId(req), req.params.projectId, req.body);
    res.status(201).json({ movement });
}
//# sourceMappingURL=inventory.controller.js.map