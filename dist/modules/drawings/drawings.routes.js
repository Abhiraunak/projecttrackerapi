import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { allow } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { uploadSingleFile } from "../../middleware/uploadImage.js";
import { createDrawingSchema, placeDrawingSchema, shareDrawingSchema } from "./drawings.schema.js";
import { requireFeature } from "../../lib/features.js";
import { drawingRevisions, listUnassigned, placeDrawing } from "./projectDrawings.service.js";
import * as c from "./drawings.controller.js";
// Uploads are the expensive request: allow far fewer of them than normal calls
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: "draft-7",
    legacyHeaders: false,
});
const router = Router();
router.use(requireAuth, allow("drawings.use"));
router.get("/", c.list);
// Phase 4 (FEATURES=drawingsByProject): sorting old drawings into projects, and a numbered drawing's history.
// "/unassigned" must come before "/:id" routes.
router.get("/unassigned", requireFeature("drawingsByProject"), async (req, res) => {
    res.json(await listUnassigned(req.user.sub));
});
router.get("/:id/revisions", requireFeature("drawingsByProject"), async (req, res) => {
    res.json(await drawingRevisions(req.user.sub, req.params.id));
});
router.patch("/:id/place", requireFeature("drawingsByProject"), validate(placeDrawingSchema), async (req, res) => {
    res.json(await placeDrawing(req.user.sub, req.params.id, req.body));
});
router.post("/", uploadLimiter, uploadSingleFile, validate(createDrawingSchema), c.create);
router.put("/:id/shares", validate(shareDrawingSchema), c.share);
router.delete("/:id", c.remove);
export default router;
//# sourceMappingURL=drawings.routes.js.map