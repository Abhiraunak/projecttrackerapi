import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createMaterialSchema, createVendorSchema } from "./catalog.schema.js";
import * as c from "./catalog.controller.js";

const router = Router();
router.use(requireAuth);

router.get("/catalog", c.catalog);
router.post("/", validate(createMaterialSchema), c.addMaterial);
router.post("/vendors", validate(createVendorSchema), c.addVendor);

export default router;
