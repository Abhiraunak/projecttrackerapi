import type { Request, Response } from "express";
import { accessLog, listUsers, updateAccess } from "./admin.service.js";
import type { UpdateAccessBody } from "./admin.schema.js";

export async function users(_req: Request, res: Response) {
  res.json({ users: await listUsers() });
}

export async function setAccess(req: Request<{ id: string }, unknown, UpdateAccessBody>, res: Response) {
  res.json({ user: await updateAccess(req.user!.sub, req.params.id, req.body) });
}

/** GET /admin/access-log?limit=15 */
export async function log(req: Request, res: Response) {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
  res.json({ items: await accessLog(limit) });
}