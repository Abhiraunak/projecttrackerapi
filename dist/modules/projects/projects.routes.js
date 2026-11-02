import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createProjectSchema, updateProjectSchema, patchProjectSchema, patchTaskSchema, } from "./projects.schema.js";
import * as c from "./projects.controller.js";
import { requireFeature } from "../../lib/features.js";
import { announceAfter } from "../../lib/live.js";
import { projectHub } from "./hub.service.js";
import { projectProgress } from "./progress.service.js";
import { projectMaterials } from "../inventory/materialSheet.service.js";
import rateLimit from "express-rate-limit";
import { HttpError } from "../../lib/error.js";
import { uploadSingleFile } from "../../middleware/uploadImage.js";
import { uploadProjectDrawingSchema } from "../drawings/drawings.schema.js";
import { listProjectDrawings, uploadProjectDrawing } from "../drawings/projectDrawings.service.js";
import { projectEquipment } from "../equipment/equipment.service.js";
// Uploads are the expensive request: the same limit as the Drawing page
const drawingUploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false });
const router = Router();
router.use(requireAuth);
// Live updates: progress, dates or money changed on a project: its client's portal reloads them, no refresh
router.use(announceAfter((req) => req.path.split("/")[1] || null));
router.get("/", c.list);
router.post("/", validate(createProjectSchema), c.create);
// The project hub: everything about one project in a single request (switched on with FEATURES=projectHub)
router.get("/:id/hub", requireFeature("projectHub"), async (req, res) => {
    res.json(await projectHub(req.user.sub, req.params.id));
});
// Phase 2: the Progress page (FEATURES=progress)
router.get("/:id/progress", requireFeature("progress"), async (req, res) => {
    res.json(await projectProgress(req.user.sub, req.params.id));
});
// Phase 3: material tiles and sheets (FEATURES=materialSheet)
router.get("/:id/materials", requireFeature("materialSheet"), async (req, res) => {
    res.json(await projectMaterials(req.user.sub, req.params.id));
});
// Phase 4: drawings by project and number (FEATURES=drawingsByProject)
router.get("/:id/drawings", requireFeature("drawingsByProject"), async (req, res) => {
    res.json(await listProjectDrawings(req.user.sub, req.params.id));
});
router.post("/:id/drawings", requireFeature("drawingsByProject"), drawingUploadLimiter, uploadSingleFile, validate(uploadProjectDrawingSchema), async (req, res) => {
    if (!req.file)
        throw new HttpError(400, "Choose a file to upload.");
    res.status(201).json(await uploadProjectDrawing({ userId: req.user.sub, projectId: req.params.id, ...req.body, file: req.file }));
});
// Phase 6: equipment at this site (FEATURES=equipment)
router.get("/:id/equipment", requireFeature("equipment"), async (req, res) => {
    res.json(await projectEquipment(req.user.sub, req.params.id));
});
router.get("/:id", c.getOne);
router.put("/:id", validate(updateProjectSchema), c.update);
router.patch("/:id", validate(patchProjectSchema), c.patchProject);
router.delete("/:id", c.remove);
router.patch("/:id/tasks/:taskId", validate(patchTaskSchema), c.patchTask);
export default router;
//# sourceMappingURL=projects.routes.js.map