import { listUsers, updateAccess } from "./admin.service.js";
export async function users(_req, res) {
    res.json({ users: await listUsers() });
}
export async function setAccess(req, res) {
    res.json({ user: await updateAccess(req.user.sub, req.params.id, req.body) });
}
//# sourceMappingURL=admin.controller.js.map