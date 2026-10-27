import type { Request, Response } from "express";
import { createMaterial, createVendor, getCatalog } from "./catalog.service.js";
import type { MaterialBody, VendorBody } from "./catalog.schema.js";

const userId =  (req: Request<any, any, any, any>) => req.user!.sub;

// A ?projectId= sent by older screens is simply ignored: the catalog is the same for every project
export async function catalog(req: Request, res: Response) {
  res.json(await getCatalog(userId(req)));
}

export async function addMaterial(req: Request<unknown, unknown, MaterialBody>, res: Response) {
  res.status(201).json({ material: await createMaterial(userId(req), req.body) });
}

export async function addVendor(req: Request<unknown, unknown, VendorBody>, res: Response) {
  res.status(201).json({ vendor: await createVendor(userId(req), req.body) });
}
