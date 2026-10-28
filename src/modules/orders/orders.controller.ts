import type { Request, Response } from "express";
import * as s from "./orders.service.js";
import type { CreateOrderBody, UpdateOrderBody } from "./orders.schema.js";

const uid = (req: Request) => req.user!.sub;

export async function list(req: Request<{ projectId: string }>, res: Response) {
  res.json({ orders: await s.listOrders(uid(req), req.params.projectId) });
}
export async function create(req: Request<{ projectId: string }, unknown, CreateOrderBody>, res: Response) {
  res.status(201).json({ order: await s.createOrder(uid(req), req.params.projectId, req.body) });
}
export async function update(req: Request<{ id: string }, unknown, UpdateOrderBody>, res: Response) {
  res.json({ order: await s.updateOrder(uid(req), req.params.id, req.body) });
}
export async function remove(req: Request<{ id: string }>, res: Response) {
  await s.deleteOrder(uid(req), req.params.id);
  res.status(204).end();
}
