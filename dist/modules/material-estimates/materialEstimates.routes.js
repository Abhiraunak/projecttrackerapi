import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createEstimateSchema, saveEstimateSchema } from "./materialEstimates.schema.js";
import { createEstimate, deleteEstimate, getEstimate, listEstimates, saveEstimate, sendToMaterials } from "./materialEstimates.service.js";
/*
 * The workspace's simple Material estimate. Mounted at /api/v1 (app.ts): app.use("/api/v1", materialEstimateRoutes).
 * Saving happens as people type, so the limit is generous.
 */
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 1500, standardHeaders: "draft-7", legacyHeaders: false });
const router = Router();
const base = "/projects/:projectId/material-estimates";
router.get(base, requireAuth, async (req, res) => {
    res.json(await listEstimates(req.user.sub, req.params.projectId));
});
router.post(base, requireAuth, writeLimiter, validate(createEstimateSchema), async (req, res) => {
    res.status(201).json(await createEstimate(req.user.sub, req.params.projectId, req.body.name));
});
router.get(`${base}/:id`, requireAuth, async (req, res) => {
    res.json(await getEstimate(req.user.sub, req.params.projectId, req.params.id));
});
router.put(`${base}/:id`, requireAuth, writeLimiter, validate(saveEstimateSchema), async (req, res) => {
    res.json(await saveEstimate(req.user.sub, req.params.projectId, req.params.id, req.body));
});
router.delete(`${base}/:id`, requireAuth, async (req, res) => {
    res.json(await deleteEstimate(req.user.sub, req.params.projectId, req.params.id));
});
router.post(`${base}/:id/send`, requireAuth, writeLimiter, async (req, res) => {
    res.json(await sendToMaterials(req.user.sub, req.params.projectId, req.params.id));
});
export default router;
//# sourceMappingURL=materialEstimates.routes.js.map