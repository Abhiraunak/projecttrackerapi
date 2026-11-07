import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createProjectSchema, updateProjectSchema, patchProjectSchema, patchTaskSchema, } from "./projects.schema.js";
import * as c from "./projects.controller.js";
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
import { measureSchema, monthQuery, searchQuery, settleSchema, weekQuery } from "../labour-weeks/labour-weeks.schema.js";
import * as weeks from "../labour-weeks/labour-weeks.service.js";
// Uploads are the expensive request: the same limit as the Drawing page
const drawingUploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false });
const router = Router();
router.use(requireAuth);
// Live updates: progress, dates or money changed on a project: its client's portal reloads them, no refresh
router.use(announceAfter((req) => req.path.split("/")[1] || null));
router.get("/", c.list);
router.post("/", validate(createProjectSchema), c.create);
// The project hub: everything about one project in a single request
router.get("/:id/hub", async (req, res) => {
    res.json(await projectHub(req.user.sub, req.params.id));
});
// Phase 2: the Progress page
router.get("/:id/progress", async (req, res) => {
    res.json(await projectProgress(req.user.sub, req.params.id));
});
// Phase 3: material tiles and sheets
router.get("/:id/materials", async (req, res) => {
    res.json(await projectMaterials(req.user.sub, req.params.id));
});
// Phase 4: drawings by project and number
router.get("/:id/drawings", async (req, res) => {
    res.json(await listProjectDrawings(req.user.sub, req.params.id));
});
router.post("/:id/drawings", drawingUploadLimiter, uploadSingleFile, validate(uploadProjectDrawingSchema), async (req, res) => {
    if (!req.file)
        throw new HttpError(400, "Choose a file to upload.");
    res.status(201).json(await uploadProjectDrawing({ userId: req.user.sub, projectId: req.params.id, ...req.body, file: req.file }));
});
// Phase 6: equipment at this site
router.get("/:id/equipment", async (req, res) => {
    res.json(await projectEquipment(req.user.sub, req.params.id));
});
// Daily expenditure: date, amount, purpose, remark and an optional bill
router.get("/:id/expenses", async (req, res) => {
    res.json(await listExpenses(req.user.sub, req.params.id));
});
router.post("/:id/expenses", drawingUploadLimiter, uploadSingleFile, validate(addExpenseSchema), async (req, res) => {
    res.status(201).json(await addExpense(req.user.sub, req.params.id, req.body, req.file));
});
router.delete("/:id/expenses/:expenseId", async (req, res) => {
    res.json(await removeExpense(req.user.sub, req.params.id, req.params.expenseId));
});
// Labour: the donut figures, and money paid to contractors (with an optional receipt)
router.get("/:id/labour-summary", async (req, res) => {
    res.json(await labourSummary(req.user.sub, req.params.id));
});
router.get("/:id/contractor-payments", async (req, res) => {
    res.json(await listPayments(req.user.sub, req.params.id));
});
router.post("/:id/contractor-payments", drawingUploadLimiter, uploadSingleFile, validate(addPaymentSchema), async (req, res) => {
    res.status(201).json(await addPayment(req.user.sub, req.params.id, req.body, req.file));
});
router.delete("/:id/contractor-payments/:paymentId", async (req, res) => {
    res.json(await removePayment(req.user.sub, req.params.id, req.params.paymentId));
});
// Labour pay week (Monday to Sunday): each contractor's earned, carried, paid and left; settle or reopen a week
router.get("/:id/labour/week", async (req, res) => {
    res.json(await weeks.weekView(req.user.sub, req.params.id, weekQuery.parse(req.query).start));
});
router.post("/:id/labour/week/settle", validate(settleSchema), async (req, res) => {
    res.json(await weeks.settleWeek(req.user.sub, req.params.id, req.body));
});
router.delete("/:id/labour/week/settle", validate(settleSchema), async (req, res) => {
    res.json(await weeks.reopenWeek(req.user.sub, req.params.id, req.body));
});
// Contract work (area × rate), the month for every contractor, and labour search
router.get("/:id/labour/measures", async (req, res) => {
    res.json(await weeks.listMeasures(req.user.sub, req.params.id));
});
router.post("/:id/labour/measures", validate(measureSchema), async (req, res) => {
    res.status(201).json(await weeks.addMeasure(req.user.sub, req.params.id, req.body));
});
router.put("/:id/labour/measures/:measureId", validate(measureSchema), async (req, res) => {
    res.json(await weeks.updateMeasure(req.user.sub, req.params.id, req.params.measureId, req.body));
});
router.delete("/:id/labour/measures/:measureId", async (req, res) => {
    res.json(await weeks.removeMeasure(req.user.sub, req.params.id, req.params.measureId));
});
router.get("/:id/labour/month", async (req, res) => {
    res.json(await weeks.monthTotals(req.user.sub, req.params.id, monthQuery.parse(req.query).month));
});
router.get("/:id/labour/search", async (req, res) => {
    res.json(await weeks.labourSearch(req.user.sub, req.params.id, searchQuery.parse(req.query).q));
});
router.get("/:id", c.getOne);
router.put("/:id", validate(updateProjectSchema), c.update);
router.patch("/:id", validate(patchProjectSchema), c.patchProject);
router.delete("/:id", c.remove);
router.patch("/:id/tasks/:taskId", validate(patchTaskSchema), c.patchTask);
export default router;
//# sourceMappingURL=projects.routes.js.map