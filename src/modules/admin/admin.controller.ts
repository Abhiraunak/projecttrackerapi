import type { Request, Response } from "express";
import { listUsers, updateAccess } from "./admin.service.js";
import type { UpdateAccessBody } from "./admin.schema.js";

export async function users(_req: Request, res: Response) {
  res.json({ users: await listUsers() });
}

export async function setAccess(req: Request<{ id: string }, unknown, UpdateAccessBody>, res: Response) {
  res.json({ user: await updateAccess(req.user!.sub, req.params.id, req.body) });
}
