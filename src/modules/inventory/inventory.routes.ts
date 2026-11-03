import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createMovementSchema } from "./inventory.schema.js";
import * as c from "./inventory.controller.js";
import { estimateSchema } from "../estimates/estimates.schema.js";
import { addEstimate, listEstimates, removeEstimate, updateEstimate } from "../estimates/estimates.service.js";

// Mounted at /api/v1, so auth is added per route (a router-wide requireAuth would also block /auth/login)
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: "draft-7", legacyHeaders: false });

const router = Router();

router.get("/projects/:projectId/inventory", requireAuth, c.inventory);

// Materials a project needs, added by hand: a quantity, or rows (steel, concrete) to work it out from
type WithProject = Request<{ projectId: string }>;
type WithEstimate = Request<{ projectId: string; estimateId: string }>;
router.get("/projects/:projectId/material-estimates", requireAuth, async (req: WithProject, res) => {
  res.json(await listEstimates(req.user!.sub, req.params.projectId));
});
router.post("/projects/:projectId/material-estimates", requireAuth, writeLimiter, validate(estimateSchema), async (req: WithProject, res) => {
  res.status(201).json(await addEstimate(req.user!.sub, req.params.projectId, req.body));
});
router.put("/projects/:projectId/material-estimates/:estimateId", requireAuth, writeLimiter, validate(estimateSchema), async (req: WithEstimate, res) => {
  res.json(await updateEstimate(req.user!.sub, req.params.projectId, req.params.estimateId, req.body));
});
router.delete("/projects/:projectId/material-estimates/:estimateId", requireAuth, async (req: WithEstimate, res) => {
  res.json(await removeEstimate(req.user!.sub, req.params.projectId, req.params.estimateId));
});
router.get("/projects/:projectId/material-cost", requireAuth, c.cost);
router.get("/projects/:projectId/stock-movements", requireAuth, c.movements);
router.post("/projects/:projectId/stock-movements", requireAuth, writeLimiter, validate(createMovementSchema), c.record);

export default router;