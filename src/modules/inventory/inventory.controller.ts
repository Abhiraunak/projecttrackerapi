import type { Request, Response } from "express";
import { getInventory, listMovements, recordMovement } from "./inventory.service.js";
import { getMaterialCost } from "./cost.service.js";
import { movementsQuerySchema, type MovementBody } from "./inventory.schema.js";

const userId = (req: Request) => req.user!.sub;

export async function inventory(req: Request<{ projectId: string }>, res: Response) {
  res.json({ items: await getInventory(userId(req), req.params.projectId) });
}

export async function movements(req: Request<{ projectId: string }>, res: Response) {
  const query = movementsQuerySchema.parse(req.query);
  res.json(await listMovements(userId(req), req.params.projectId, query));
}

export async function record(req: Request<{ projectId: string }, unknown, MovementBody>, res: Response) {
  const movement = await recordMovement(userId(req), req.params.projectId, req.body);
  res.status(201).json({ movement });
}

export async function cost(req: Request<{ projectId: string }>, res: Response) {
  res.json(await getMaterialCost(userId(req), req.params.projectId));
}
