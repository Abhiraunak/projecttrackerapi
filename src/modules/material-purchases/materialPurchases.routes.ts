import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { uploadSingleFile } from "../../middleware/uploadImage.js";
import { addDeliverySchema, addPurchaseSchema, archiveDeliverySchema, archivePurchaseSchema, deletePurchasesSchema, importFromEstimateSchema, updateDeliverySchema, updatePurchaseSchema } from "./materialPurchases.schema.js";
import { estimateLines, importFromEstimate } from "./materialPurchases.estimate.js";
import { addDelivery, addPurchase, archiveDelivery, archivePurchase, listPurchases, removeDelivery, removePurchase, removePurchases, updateDelivery, updatePurchase } from "./materialPurchases.service.js";

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
// Delete several archived materials at once, all or nothing (before /:purchaseId, so "bulk-delete" isn't read as an id)
router.post("/projects/:projectId/material-purchases/bulk-delete", requireAuth, writeLimiter, validate(deletePurchasesSchema), async (req: WithProject, res) => {
    res.json(await removePurchases(req.user!.sub, req.params.projectId, req.body.ids));
});
// Archive a material (it leaves the list and stops counting) or restore it
router.post("/projects/:projectId/material-purchases/:purchaseId/archive", requireAuth, writeLimiter, validate(archivePurchaseSchema), async (req: WithPurchase, res) => {
    res.json(await archivePurchase(req.user!.sub, req.params.projectId, req.params.purchaseId, req.body.archived));
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
// Correct a delivery (date, how many, rate or amount)
router.put("/projects/:projectId/material-purchases/:purchaseId/deliveries/:deliveryId", requireAuth, writeLimiter, validate(updateDeliverySchema), async (req: WithDelivery, res) => {
    res.json(await updateDelivery(req.user!.sub, req.params.projectId, req.params.purchaseId, req.params.deliveryId, req.body));
});
// Archive it (it stops counting) or restore it; only an archived delivery can be deleted
router.post("/projects/:projectId/material-purchases/:purchaseId/deliveries/:deliveryId/archive", requireAuth, writeLimiter, validate(archiveDeliverySchema), async (req: WithDelivery, res) => {
    res.json(await archiveDelivery(req.user!.sub, req.params.projectId, req.params.purchaseId, req.params.deliveryId, req.body.archived));
});
router.delete("/projects/:projectId/material-purchases/:purchaseId/deliveries/:deliveryId", requireAuth, async (req: WithDelivery, res) => {
    res.json(await removeDelivery(req.user!.sub, req.params.projectId, req.params.purchaseId, req.params.deliveryId));
});

export default router;