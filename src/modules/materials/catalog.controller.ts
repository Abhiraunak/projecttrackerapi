import type { Request, Response } from "express";
import { createMaterial, createVendor, getCatalog } from "./catalog.service.js";
import type { MaterialBody, VendorBody } from "./catalog.schema.js";

const ownerId = (req: Request) => req.user!.sub;

export async function catalog(req: Request, res: Response) {
  res.json(await getCatalog(ownerId(req)));
}

export async function addMaterial(req: Request<unknown, unknown, MaterialBody>, res: Response) {
  res.status(201).json({ material: await createMaterial(ownerId(req), req.body) });
}

export async function addVendor(req: Request<unknown, unknown, VendorBody>, res: Response) {
  res.status(201).json({ vendor: await createVendor(ownerId(req), req.body) });
}
