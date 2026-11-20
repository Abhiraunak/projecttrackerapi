import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { uploadSingleFile } from "../../middleware/uploadImage.js";
import { addDeliverySchema, addPurchaseSchema, importFromEstimateSchema, updatePurchaseSchema } from "./materialPurchases.schema.js";
import { estimateLines, importFromEstimate } from "./materialPurchases.estimate.js";
import { addDelivery, addPurchase, listPurchases, removeDelivery, removePurchase, updatePurchase } from "./materialPurchases.service.js";

/*
 * The workspace's Materials section: materials bought (quantity × rate, an optional bill; the same name again adds
 * to it), and their deliveries. Mounted at /api/v1 (app.ts), so auth is added per route. These routes used to live
 * in the old inventory router; the paths are unchanged.
 */
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: "draft-7", legacyHeaders: false });
const router = Router();

type WithProject = Request<{ projectId: string }>;
type WithPurchase = Request<{ projectId: string; purchaseId: string }>;
type WithDelivery = Request<{ projectId: string; purchaseId: string; deliveryId: string }>;

router.get("/projects/:projectId/material-purchases", requireAuth, async (req: WithProject, res) => {
    res.json(await listPurchases(req.user!.sub, req.params.projectId));
});
router.post("/projects/:projectId/material-purchases", requireAuth, writeLimiter, uploadSingleFile, validate(addPurchaseSchema), async (req: WithProject, res) => {
    res.status(201).json(await addPurchase(req.user!.sub, req.params.projectId, req.body, req.file));
});
// The Material estimate's lines, and bringing chosen ones in as materials (before /:purchaseId, so "estimate" isn't read as an id)
router.get("/projects/:projectId/material-purchases/estimate", requireAuth, async (req: WithProject, res) => {
    res.json(await estimateLines(req.user!.sub, req.params.projectId));
});
router.post("/projects/:projectId/material-purchases/from-estimate", requireAuth, writeLimiter, validate(importFromEstimateSchema), async (req: WithProject, res) => {
    res.status(201).json(await importFromEstimate(req.user!.sub, req.params.projectId, req.body));
});
router.put("/projects/:projectId/material-purchases/:purchaseId", requireAuth, writeLimiter, uploadSingleFile, validate(updatePurchaseSchema), async (req: WithPurchase, res) => {
    res.json(await updatePurchase(req.user!.sub, req.params.projectId, req.params.purchaseId, req.body, req.file));
});
router.delete("/projects/:projectId/material-purchases/:purchaseId", requireAuth, async (req: WithPurchase, res) => {
    res.json(await removePurchase(req.user!.sub, req.params.projectId, req.params.purchaseId));
});

// Deliveries of one material: on what date how many arrived, at what rate, with an optional bill
router.post("/projects/:projectId/material-purchases/:purchaseId/deliveries", requireAuth, writeLimiter, uploadSingleFile, validate(addDeliverySchema), async (req: WithPurchase, res) => {
    res.status(201).json(await addDelivery(req.user!.sub, req.params.projectId, req.params.purchaseId, req.body, req.file));
});
router.delete("/projects/:projectId/material-purchases/:purchaseId/deliveries/:deliveryId", requireAuth, async (req: WithDelivery, res) => {
    res.json(await removeDelivery(req.user!.sub, req.params.projectId, req.params.purchaseId, req.params.deliveryId));
});

export default router;