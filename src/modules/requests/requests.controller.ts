import type { Request, Response } from "express";
import * as s from "./requests.service.js";
import { listQuerySchema, type CreateRequestBody, type IssueBody, type OrderFromRequestBody } from "./requests.schema.js";

const uid = (req: Request) => req.user!.sub;
type Id = Request<{ id: string }, unknown, { note: string }>;

export async function list(req: Request<{ projectId: string }>, res: Response) {
  const { status } = listQuerySchema.parse(req.query);
  res.json({ requests: await s.listRequests(uid(req), req.params.projectId, status) });
}
export async function create(req: Request<{ projectId: string }, unknown, CreateRequestBody>, res: Response) {
  res.status(201).json({ request: await s.createRequest(uid(req), req.params.projectId, req.body) });
}
export const approve = async (req: Id, res: Response) => res.json({ request: await s.decide(uid(req), req.params.id, "approve", req.body.note) });
export const reject = async (req: Id, res: Response) => res.json({ request: await s.decide(uid(req), req.params.id, "reject", req.body.note) });
export const cancel = async (req: Id, res: Response) => res.json({ request: await s.decide(uid(req), req.params.id, "cancel", req.body.note) });
export async function issue(req: Request<{ id: string }, unknown, IssueBody>, res: Response) {
  res.json({ request: await s.issue(uid(req), req.params.id, req.body) });
}
export async function order(req: Request<{ id: string }, unknown, OrderFromRequestBody>, res: Response) {
  res.json({ request: await s.orderFor(uid(req), req.params.id, req.body) });
}
export async function pending(req: Request, res: Response) {
  res.json({ pending: await s.pendingForMe(uid(req)) });
}
