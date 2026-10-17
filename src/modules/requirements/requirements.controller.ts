import type { Request, Response } from "express";
import { createRequirement, deleteRequirement, listRequirements, updateOrder } from "./requirements.service.js";
import type { CreateRequirementBody, OrderBody } from "./requirements.schema.js";

const ownerId = (req: Request) => req.user!.sub;

export async function list(req: Request<{ projectId: string }>, res: Response) {
  res.json({ requirements: await listRequirements(ownerId(req), req.params.projectId) });
}

export async function create(req: Request<{ projectId: string }, unknown, CreateRequirementBody>, res: Response) {
  const requirement = await createRequirement(ownerId(req), req.params.projectId, req.body);
  res.status(201).json({ requirement });
}

export async function order(req: Request<{ id: string }, unknown, OrderBody>, res: Response) {
  res.json({ requirement: await updateOrder(ownerId(req), req.params.id, req.body) });
}

export async function remove(req: Request<{ id: string }>, res: Response) {
  await deleteRequirement(ownerId(req), req.params.id);
  res.status(204).end();
}
