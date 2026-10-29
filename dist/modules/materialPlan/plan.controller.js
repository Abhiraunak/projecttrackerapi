import * as s from "./plan.service.js";
const uid = (req) => req.user.sub;
export const plan = async (req, res) => res.json(await s.getPlan(uid(req), req.params.projectId));
export const preview = async (req, res) => res.json(await s.previewSync(uid(req), req.params.projectId));
export const sync = async (req, res) => res.json(await s.applySync(uid(req), req.params.projectId));
export const importableBoqs = async (req, res) => res.json(await s.listImportableBoqs(uid(req), req.params.projectId));
export const importOutline = async (req, res) => res.json(await s.getImportOutline(uid(req), req.params.projectId, req.params.boqId));
export const importItems = async (req, res) => res.json(await s.importFromBoq(uid(req), req.params.projectId, req.body));
export async function itemMaterials(req, res) {
    res.json({ item: await s.saveItemMaterials(uid(req), req.params.itemId, req.body) });
}
export const recipes = async (req, res) => res.json({ recipes: await s.listRecipes(uid(req)) });
export async function createRecipe(req, res) {
    res.status(201).json({ recipe: await s.createRecipe(uid(req), req.body) });
}
export async function updateRecipe(req, res) {
    res.json({ recipe: await s.updateRecipe(uid(req), req.params.id, req.body) });
}
export async function deleteRecipe(req, res) {
    await s.deleteRecipe(uid(req), req.params.id);
    res.status(204).end();
}
//# sourceMappingURL=plan.controller.js.map