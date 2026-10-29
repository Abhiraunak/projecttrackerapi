import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createMaterialSchema, createVendorSchema, updateMaterialSchema, updateVendorSchema } from "./catalog.schema.js";
import * as c from "./catalog.controller.js";
// Mounted at /api/v1/materials
const router = Router();
router.use(requireAuth);
router.get("/catalog", c.catalog);
router.post("/", validate(createMaterialSchema), c.addMaterial);
router.put("/vendors/:id", validate(updateVendorSchema), c.editVendor); // before "/:id", so "vendors" is never read as a material id
router.delete("/vendors/:id", c.removeVendor);
router.post("/vendors", validate(createVendorSchema), c.addVendor);
router.put("/:id", validate(updateMaterialSchema), c.editMaterial);
export default router;
//# sourceMappingURL=catalog.routes.js.map