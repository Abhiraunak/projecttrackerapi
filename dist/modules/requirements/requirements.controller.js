import { createRequirement, deleteRequirement, listRequirements, updateOrder } from "./requirements.service.js";
const ownerId = (req) => req.user.sub;
export async function list(req, res) {
    res.json({ requirements: await listRequirements(ownerId(req), req.params.projectId) });
}
export async function create(req, res) {
    const requirement = await createRequirement(ownerId(req), req.params.projectId, req.body);
    res.status(201).json({ requirement });
}
export async function order(req, res) {
    res.json({ requirement: await updateOrder(ownerId(req), req.params.id, req.body) });
}
export async function remove(req, res) {
    await deleteRequirement(ownerId(req), req.params.id);
    res.status(204).end();
}
//# sourceMappingURL=requirements.controller.js.map