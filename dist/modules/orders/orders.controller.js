import * as s from "./orders.service.js";
const uid = (req) => req.user.sub;
export async function list(req, res) {
    res.json({ orders: await s.listOrders(uid(req), req.params.projectId) });
}
export async function create(req, res) {
    res.status(201).json({ order: await s.createOrder(uid(req), req.params.projectId, req.body) });
}
export async function update(req, res) {
    res.json({ order: await s.updateOrder(uid(req), req.params.id, req.body) });
}
export async function remove(req, res) {
    await s.deleteOrder(uid(req), req.params.id);
    res.status(204).end();
}
//# sourceMappingURL=orders.controller.js.map