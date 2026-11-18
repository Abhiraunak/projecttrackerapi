import { accessLog, listUsers, updateAccess } from "./admin.service.js";
export async function users(_req, res) {
    res.json({ users: await listUsers() });
}
export async function setAccess(req, res) {
    res.json({ user: await updateAccess(req.user.sub, req.params.id, req.body) });
}
/** GET /admin/access-log?limit=15 */
export async function log(req, res) {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
    res.json({ items: await accessLog(limit) });
}
//# sourceMappingURL=admin.controller.js.map