import type { Request, Response } from "express";
import { getInventory, listMovements, recordMovement } from "./inventory.service.js";
import { movementsQuerySchema, type MovementBody } from "./inventory.schema.js";

const ownerId = (req: Request) => req.user!.sub;

export async function inventory(req: Request<{ projectId: string }>, res: Response) {
  res.json({ items: await getInventory(ownerId(req), req.params.projectId) });
}

export async function movements(req: Request<{ projectId: string }>, res: Response) {
  const query = movementsQuerySchema.parse(req.query);
  res.json(await listMovements(ownerId(req), req.params.projectId, query));
}

export async function record(req: Request<{ projectId: string }, unknown, MovementBody>, res: Response) {
  const movement = await recordMovement(ownerId(req), req.params.projectId, req.body);
  res.status(201).json({ movement });
}
