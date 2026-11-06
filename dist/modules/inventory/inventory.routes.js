import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createMovementSchema, quickMoveSchema } from "./inventory.schema.js";
import { materialDetail, materialsOverview, quickMove } from "./materialsTab.service.js";
import { uploadSingleFile } from "../../middleware/uploadImage.js";
import { addMaterialPayment, listMaterialPayments, removeMaterialPayment } from "../material-payments/materialPayments.service.js";
import * as c from "./inventory.controller.js";
import { estimateSchema } from "../estimates/estimates.schema.js";
import { addDeliverySchema, addPurchaseSchema, fromBoqSchema, updatePurchaseSchema } from "../material-purchases/materialPurchases.schema.js";
import { addDelivery, addFromBoq, addPurchase, boqMaterials, listPurchases, removeDelivery, removePurchase, updatePurchase } from "../material-purchases/materialPurchases.service.js";
import { addEstimate, listEstimates, removeEstimate, updateEstimate } from "../estimates/estimates.service.js";
import { addMaterialPaymentSchema } from "../material-payments/materialPayments.js";
// Mounted at /api/v1, so auth is added per route (a router-wide requireAuth would also block /auth/login)
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: "draft-7", legacyHeaders: false });
const router = Router();
router.get("/projects/:projectId/inventory", requireAuth, c.inventory);
router.get("/projects/:projectId/materials-tab", requireAuth, async (req, res) => {
    res.json(await materialsOverview(req.user.sub, req.params.projectId));
});
router.get("/projects/:projectId/materials-tab/:materialId", requireAuth, async (req, res) => {
    res.json(await materialDetail(req.user.sub, req.params.projectId, req.params.materialId));
});
router.post("/projects/:projectId/materials-tab/moves", requireAuth, writeLimiter, uploadSingleFile, validate(quickMoveSchema), async (req, res) => {
    res.status(201).json(await quickMove(req.user.sub, req.params.projectId, req.body, req.file));
});
router.get("/projects/:projectId/material-purchases", requireAuth, async (req, res) => {
    res.json(await listPurchases(req.user.sub, req.params.projectId));
});
router.post("/projects/:projectId/material-purchases", requireAuth, writeLimiter, uploadSingleFile, validate(addPurchaseSchema), async (req, res) => {
    res.status(201).json(await addPurchase(req.user.sub, req.params.projectId, req.body, req.file));
});
// The BOQ's materials by sheet, to pick and add to the list (registered before /:purchaseId routes on purpose)
router.get("/projects/:projectId/material-purchases/from-boq", requireAuth, async (req, res) => {
    res.json(await boqMaterials(req.user.sub, req.params.projectId));
});
router.post("/projects/:projectId/material-purchases/from-boq", requireAuth, writeLimiter, validate(fromBoqSchema), async (req, res) => {
    res.status(201).json(await addFromBoq(req.user.sub, req.params.projectId, req.body));
});
router.put("/projects/:projectId/material-purchases/:purchaseId", requireAuth, writeLimiter, uploadSingleFile, validate(updatePurchaseSchema), async (req, res) => {
    res.json(await updatePurchase(req.user.sub, req.params.projectId, req.params.purchaseId, req.body, req.file));
});
router.delete("/projects/:projectId/material-purchases/:purchaseId", requireAuth, async (req, res) => {
    res.json(await removePurchase(req.user.sub, req.params.projectId, req.params.purchaseId));
});
router.post("/projects/:projectId/material-purchases/:purchaseId/deliveries", requireAuth, writeLimiter, uploadSingleFile, validate(addDeliverySchema), async (req, res) => {
    res.status(201).json(await addDelivery(req.user.sub, req.params.projectId, req.params.purchaseId, req.body, req.file));
});
router.delete("/projects/:projectId/material-purchases/:purchaseId/deliveries/:deliveryId", requireAuth, async (req, res) => {
    res.json(await removeDelivery(req.user.sub, req.params.projectId, req.params.purchaseId, req.params.deliveryId));
});
// Money paid to material vendors (with an optional receipt), and each vendor's bought / paid / still owed
router.get("/projects/:projectId/material-payments", requireAuth, async (req, res) => {
    res.json(await listMaterialPayments(req.user.sub, req.params.projectId));
});
router.post("/projects/:projectId/material-payments", requireAuth, writeLimiter, uploadSingleFile, validate(addMaterialPaymentSchema), async (req, res) => {
    res.status(201).json(await addMaterialPayment(req.user.sub, req.params.projectId, req.body, req.file));
});
router.delete("/projects/:projectId/material-payments/:paymentId", requireAuth, async (req, res) => {
    res.json(await removeMaterialPayment(req.user.sub, req.params.projectId, req.params.paymentId));
});
router.get("/projects/:projectId/material-estimates", requireAuth, async (req, res) => {
    res.json(await listEstimates(req.user.sub, req.params.projectId));
});
router.post("/projects/:projectId/material-estimates", requireAuth, writeLimiter, validate(estimateSchema), async (req, res) => {
    res.status(201).json(await addEstimate(req.user.sub, req.params.projectId, req.body));
});
router.put("/projects/:projectId/material-estimates/:estimateId", requireAuth, writeLimiter, validate(estimateSchema), async (req, res) => {
    res.json(await updateEstimate(req.user.sub, req.params.projectId, req.params.estimateId, req.body));
});
router.delete("/projects/:projectId/material-estimates/:estimateId", requireAuth, async (req, res) => {
    res.json(await removeEstimate(req.user.sub, req.params.projectId, req.params.estimateId));
});
router.get("/projects/:projectId/material-cost", requireAuth, c.cost);
router.get("/projects/:projectId/stock-movements", requireAuth, c.movements);
router.post("/projects/:projectId/stock-movements", requireAuth, writeLimiter, validate(createMovementSchema), c.record);
export default router;
//# sourceMappingURL=inventory.routes.js.map