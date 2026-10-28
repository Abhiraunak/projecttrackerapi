import type { Request, Response } from "express";
import { createMaterial, createVendor, deleteVendor, getCatalog, updateMaterial, updateVendor } from "./catalog.service.js";
import type { MaterialBody, VendorBody } from "./catalog.schema.js";

const userId = (req: Request) => req.user!.sub;

// A ?projectId= sent by older screens is simply ignored: the catalog is the same for every project
export async function catalog(req: Request, res: Response) {
  res.json(await getCatalog(userId(req)));
}

export async function addMaterial(req: Request<unknown, unknown, MaterialBody>, res: Response) {
  res.status(201).json({ material: await createMaterial(userId(req), req.body) });
}

export async function editMaterial(req: Request<{ id: string }, unknown, MaterialBody>, res: Response) {
  res.json({ material: await updateMaterial(userId(req), req.params.id, req.body) });
}

export async function addVendor(req: Request<unknown, unknown, VendorBody>, res: Response) {
  res.status(201).json({ vendor: await createVendor(userId(req), req.body) });
}

export async function editVendor(req: Request<{ id: string }, unknown, VendorBody>, res: Response) {
  res.json({ vendor: await updateVendor(userId(req), req.params.id, req.body) });
}

export async function removeVendor(req: Request<{ id: string }>, res: Response) {
  await deleteVendor(userId(req), req.params.id);
  res.status(204).end();
}
