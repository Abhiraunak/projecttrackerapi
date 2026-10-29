import { createMaterial, createVendor, deleteVendor, getCatalog, updateMaterial, updateVendor } from "./catalog.service.js";
const userId = (req) => req.user.sub;
// A ?projectId= sent by older screens is simply ignored: the catalog is the same for every project
export async function catalog(req, res) {
    res.json(await getCatalog(userId(req)));
}
export async function addMaterial(req, res) {
    res.status(201).json({ material: await createMaterial(userId(req), req.body) });
}
export async function editMaterial(req, res) {
    res.json({ material: await updateMaterial(userId(req), req.params.id, req.body) });
}
export async function addVendor(req, res) {
    res.status(201).json({ vendor: await createVendor(userId(req), req.body) });
}
export async function editVendor(req, res) {
    res.json({ vendor: await updateVendor(userId(req), req.params.id, req.body) });
}
export async function removeVendor(req, res) {
    await deleteVendor(userId(req), req.params.id);
    res.status(204).end();
}
//# sourceMappingURL=catalog.controller.js.map