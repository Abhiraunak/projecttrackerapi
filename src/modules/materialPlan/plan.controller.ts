import type { Request, Response } from "express";
import * as s from "./plan.service.js";
import type { ImportBody, ItemMaterialsBody, RecipeBody } from "./plan.schema.js";

const uid = (req: Request) => req.user!.sub;
type P = Request<{ projectId: string }>;

export const plan = async (req: P, res: Response) => res.json(await s.getPlan(uid(req), req.params.projectId));
export const preview = async (req: P, res: Response) => res.json(await s.previewSync(uid(req), req.params.projectId));
export const sync = async (req: P, res: Response) => res.json(await s.applySync(uid(req), req.params.projectId));

export const importableBoqs = async (req: P, res: Response) => res.json(await s.listImportableBoqs(uid(req), req.params.projectId));
export const importOutline = async (req: Request<{ projectId: string; boqId: string }>, res: Response) =>
  res.json(await s.getImportOutline(uid(req), req.params.projectId, req.params.boqId));
export const importItems = async (req: Request<{ projectId: string }, unknown, ImportBody>, res: Response) =>
  res.json(await s.importFromBoq(uid(req), req.params.projectId, req.body));

export async function itemMaterials(req: Request<{ itemId: string }, unknown, ItemMaterialsBody>, res: Response) {
  res.json({ item: await s.saveItemMaterials(uid(req), req.params.itemId, req.body) });
}

export const recipes = async (req: Request, res: Response) => res.json({ recipes: await s.listRecipes(uid(req)) });

export async function createRecipe(req: Request<unknown, unknown, RecipeBody>, res: Response) {
  res.status(201).json({ recipe: await s.createRecipe(uid(req), req.body) });
}

export async function updateRecipe(req: Request<{ id: string }, unknown, RecipeBody>, res: Response) {
  res.json({ recipe: await s.updateRecipe(uid(req), req.params.id, req.body) });
}

export async function deleteRecipe(req: Request<{ id: string }>, res: Response) {
  await s.deleteRecipe(uid(req), req.params.id);
  res.status(204).end();
}
