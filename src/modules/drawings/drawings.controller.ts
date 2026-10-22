import type { Request, Response } from "express";

import { createDrawing, deleteDrawing, listDrawings, replaceShares } from "./drawings.service.js";
import { listQuerySchema, type CreateBody, type ShareBody } from "./drawings.schema.js";
import { HttpError } from "../../lib/error.js";

const viewerId = (req: Request<any, any, any, any>) => req.user!.sub;


export async function list(req: Request, res: Response) {
  const query = listQuerySchema.parse(req.query);
  res.json(await listDrawings(viewerId(req), query));
}

export async function create(req: Request<unknown, unknown, CreateBody>, res: Response) {
  if (!req.file) throw new HttpError(400, "Choose a file to upload.");
  const drawing = await createDrawing({ ownerId: viewerId(req), ...req.body, file: req.file });
  res.status(201).json({ drawing });
}

export async function share(req: Request<{ id: string }, unknown, ShareBody>, res: Response) {
  const drawing = await replaceShares(viewerId(req), req.params.id, req.body.userIds);
  res.json({ drawing });
}

export async function remove(req: Request<{ id: string }>, res: Response) {
  await deleteDrawing(viewerId(req), req.params.id);
  res.status(204).end();
}