import type { Request, Response } from "express";
import { createBoq, deleteBoq, duplicateBoq, getBoq, listBoqs, saveBoq } from "./boqs.service.js";
import { listQuerySchema, type BoqDocumentInput, type SaveBody } from "./boqs.schema.js";

const userId = (req: Request) => req.user!.sub;

export async function list(req: Request, res: Response) {
  res.json(await listBoqs(listQuerySchema.parse(req.query)));
}

export async function getOne(req: Request<{ id: string }>, res: Response) {
  res.json({ boq: await getBoq(req.params.id) });
}

export async function create(req: Request<unknown, unknown, { document: BoqDocumentInput }>, res: Response) {
  res.status(201).json({ boq: await createBoq(userId(req), req.body.document) });
}

export async function duplicate(req: Request<{ id: string }>, res: Response) {
  res.status(201).json({ boq: await duplicateBoq(userId(req), req.params.id) });
}

export async function save(req: Request<{ id: string }, unknown, SaveBody>, res: Response) {
  res.json({ boq: await saveBoq(userId(req), req.params.id, req.body) });
}

export async function remove(req: Request<{ id: string }>, res: Response) {
  await deleteBoq(userId(req), req.params.id);
  res.status(204).end();
}
