import { Router, type Request } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createProjectSchema,
  updateProjectSchema,
  patchProjectSchema,
  patchTaskSchema,
} from "./projects.schema.js";
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
import { addExpenseSchema } from "../expenses/expenses.schema.js";
import { addExpense, listExpenses, removeExpense } from "../expenses/expenses.service.js";
import { addPaymentSchema } from "../contractor-payments/contractor-payments.schema.js";
import { addPayment, labourSummary, listPayments, removePayment } from "../contractor-payments/contractor-payments.service.js";

// Uploads are the expensive request: the same limit as the Drawing page
const drawingUploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false });

/** Routes under /:id: the id is always there (req.params is otherwise a loose dictionary) */
type WithId = Request<{ id: string }>;

const router = Router();
router.use(requireAuth);
// Live updates: progress, dates or money changed on a project: its client's portal reloads them, no refresh
router.use(announceAfter((req) => req.path.split("/")[1] || null));

router.get("/", c.list);
router.post("/", validate(createProjectSchema), c.create);
// The project hub: everything about one project in a single request (switched on with FEATURES=projectHub)
router.get("/:id/hub", requireFeature("projectHub"), async (req: WithId, res) => {
  res.json(await projectHub(req.user!.sub, req.params.id));
});
// Phase 2: the Progress page (FEATURES=progress)
router.get("/:id/progress", requireFeature("progress"), async (req: WithId, res) => {
  res.json(await projectProgress(req.user!.sub, req.params.id));
});
// Phase 3: material tiles and sheets (FEATURES=materialSheet)
router.get("/:id/materials", requireFeature("materialSheet"), async (req: WithId, res) => {
  res.json(await projectMaterials(req.user!.sub, req.params.id));
});
// Phase 4: drawings by project and number (FEATURES=drawingsByProject)
router.get("/:id/drawings", requireFeature("drawingsByProject"), async (req: WithId, res) => {
  res.json(await listProjectDrawings(req.user!.sub, req.params.id));
});
router.post("/:id/drawings", requireFeature("drawingsByProject"), drawingUploadLimiter, uploadSingleFile, validate(uploadProjectDrawingSchema), async (req: WithId, res) => {
  if (!req.file) throw new HttpError(400, "Choose a file to upload.");
  res.status(201).json(await uploadProjectDrawing({ userId: req.user!.sub, projectId: req.params.id, ...req.body, file: req.file }));
});
// Phase 6: equipment at this site (FEATURES=equipment)
router.get("/:id/equipment", requireFeature("equipment"), async (req: WithId, res) => {
  res.json(await projectEquipment(req.user!.sub, req.params.id));
});
// Daily expenditure: date, amount, purpose, remark and an optional bill
router.get("/:id/expenses", async (req: WithId, res) => {
  res.json(await listExpenses(req.user!.sub, req.params.id));
});
router.post("/:id/expenses", drawingUploadLimiter, uploadSingleFile, validate(addExpenseSchema), async (req: WithId, res) => {
  res.status(201).json(await addExpense(req.user!.sub, req.params.id, req.body, req.file));
});
router.delete("/:id/expenses/:expenseId", async (req: Request<{ id: string; expenseId: string }>, res) => {
  res.json(await removeExpense(req.user!.sub, req.params.id, req.params.expenseId));
});
   router.get("/:id/labour-summary", async (req: WithId, res) => {
     res.json(await labourSummary(req.user!.sub, req.params.id));
   });
   router.get("/:id/contractor-payments", async (req: WithId, res) => {
     res.json(await listPayments(req.user!.sub, req.params.id));
   });
   router.post("/:id/contractor-payments", drawingUploadLimiter, uploadSingleFile, validate(addPaymentSchema), async (req: WithId, res) => {
     res.status(201).json(await addPayment(req.user!.sub, req.params.id, req.body, req.file));
   });
   router.delete("/:id/contractor-payments/:paymentId", async (req: Request<{ id: string; paymentId: string }>, res) => {
     res.json(await removePayment(req.user!.sub, req.params.id, req.params.paymentId));
   });
router.get("/:id", c.getOne);
router.put("/:id", validate(updateProjectSchema), c.update);
router.patch("/:id", validate(patchProjectSchema), c.patchProject);
router.delete("/:id", c.remove);
router.patch("/:id/tasks/:taskId", validate(patchTaskSchema), c.patchTask);

export default router;