import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { importSchema, itemMaterialsSchema, recipeSchema } from "./plan.schema.js";
import * as c from "./plan.controller.js";

// Mounted at /api/v1, so auth is added per route. Permissions are checked in the service, per project.
const syncLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });

const router = Router();
router.get("/projects/:projectId/material-plan", requireAuth, c.plan);
router.get("/projects/:projectId/material-plan/sync", requireAuth, c.preview);
router.post("/projects/:projectId/material-plan/sync", requireAuth, syncLimiter, c.sync);
router.get("/projects/:projectId/material-plan/boqs", requireAuth, c.importableBoqs);
router.get("/projects/:projectId/material-plan/boqs/:boqId", requireAuth, c.importOutline);
router.post("/projects/:projectId/material-plan/import", requireAuth, syncLimiter, validate(importSchema), c.importItems);
router.put("/boq-items/:itemId/materials", requireAuth, validate(itemMaterialsSchema), c.itemMaterials);

router.get("/material-recipes", requireAuth, c.recipes);
router.post("/material-recipes", requireAuth, validate(recipeSchema), c.createRecipe);
router.put("/material-recipes/:id", requireAuth, validate(recipeSchema), c.updateRecipe);
router.delete("/material-recipes/:id", requireAuth, c.deleteRecipe);

export default router;
