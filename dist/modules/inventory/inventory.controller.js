import { getInventory, listMovements, recordMovement } from "./inventory.service.js";
import { getMaterialCost } from "./cost.service.js";
import { movementsQuerySchema } from "./inventory.schema.js";
const userId = (req) => req.user.sub;
export async function inventory(req, res) {
    res.json({ items: await getInventory(userId(req), req.params.projectId) });
}
export async function movements(req, res) {
    const query = movementsQuerySchema.parse(req.query);
    res.json(await listMovements(userId(req), req.params.projectId, query));
}
export async function record(req, res) {
    const movement = await recordMovement(userId(req), req.params.projectId, req.body);
    res.status(201).json({ movement });
}
export async function cost(req, res) {
    res.json(await getMaterialCost(userId(req), req.params.projectId));
}
//# sourceMappingURL=inventory.controller.js.map