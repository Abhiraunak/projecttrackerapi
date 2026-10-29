import { createBoq, deleteBoq, duplicateBoq, getBoq, listBoqs, saveBoq, setBoqProject } from "./boqs.service.js";
import { listQuerySchema } from "./boqs.schema.js";
const userId = (req) => req.user.sub;
export async function list(req, res) {
    res.json(await listBoqs(listQuerySchema.parse(req.query)));
}
export async function getOne(req, res) {
    res.json({ boq: await getBoq(req.params.id) });
}
export async function create(req, res) {
    res.status(201).json({ boq: await createBoq(userId(req), req.body.document, req.body.projectId) });
}
export async function duplicate(req, res) {
    res.status(201).json({ boq: await duplicateBoq(userId(req), req.params.id) });
}
export async function save(req, res) {
    res.json({ boq: await saveBoq(userId(req), req.params.id, req.body) });
}
export async function remove(req, res) {
    await deleteBoq(userId(req), req.params.id);
    res.status(204).end();
}
export async function setProject(req, res) {
    res.json({ boq: await setBoqProject(userId(req), req.params.id, req.body.projectId) });
}
//# sourceMappingURL=boqs.controller.js.map