import { createMaterial, createVendor, getCatalog } from "./catalog.service.js";
const ownerId = (req) => req.user.sub;
export async function catalog(req, res) {
    res.json(await getCatalog(ownerId(req)));
}
export async function addMaterial(req, res) {
    res.status(201).json({ material: await createMaterial(ownerId(req), req.body) });
}
export async function addVendor(req, res) {
    res.status(201).json({ vendor: await createVendor(ownerId(req), req.body) });
}
//# sourceMappingURL=catalog.controller.js.map