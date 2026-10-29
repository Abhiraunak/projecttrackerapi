import * as s from "./requests.service.js";
import { listQuerySchema } from "./requests.schema.js";
const uid = (req) => req.user.sub;
export async function list(req, res) {
    const { status } = listQuerySchema.parse(req.query);
    res.json({ requests: await s.listRequests(uid(req), req.params.projectId, status) });
}
export async function create(req, res) {
    res.status(201).json({ request: await s.createRequest(uid(req), req.params.projectId, req.body) });
}
export const approve = async (req, res) => res.json({ request: await s.decide(uid(req), req.params.id, "approve", req.body.note) });
export const reject = async (req, res) => res.json({ request: await s.decide(uid(req), req.params.id, "reject", req.body.note) });
export const cancel = async (req, res) => res.json({ request: await s.decide(uid(req), req.params.id, "cancel", req.body.note) });
export async function issue(req, res) {
    res.json({ request: await s.issue(uid(req), req.params.id, req.body) });
}
export async function order(req, res) {
    res.json({ request: await s.orderFor(uid(req), req.params.id, req.body) });
}
export async function pending(req, res) {
    res.json({ pending: await s.pendingForMe(uid(req)) });
}
//# sourceMappingURL=requests.controller.js.map