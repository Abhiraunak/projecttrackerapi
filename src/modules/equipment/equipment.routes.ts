import { Router, type Request } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { uploadSingleFile } from "../../middleware/uploadImage.js";
import { createEquipmentSchema, hireChangeSchema, moveSchema, updateEquipmentSchema } from "./equipment.schema.js";
import {
  addHireChange,
  addMove,
  createEquipment,
  deleteEquipment,
  getEquipment,
  listEquipment,
  removeEquipmentBill,
  removeHireChange,
  setEquipmentBill,
  undoMove,
  updateEquipment,
} from "./equipment.service.js";

/** The equipment register. Mounted at /api/v1/equipment. */
/** Routes under /:id: the id is always there (req.params is otherwise a loose dictionary) */
type WithId = Request<{ id: string }>;
type WithMove = Request<{ id: string; moveId: string }>;

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  res.json(await listEquipment(req.user!.sub));
});
router.post("/", validate(createEquipmentSchema), async (req, res) => {
  res.status(201).json(await createEquipment(req.user!.sub, req.body));
});
router.get("/:id", async (req: WithId, res) => {
  res.json(await getEquipment(req.user!.sub, req.params.id));
});
router.patch("/:id", validate(updateEquipmentSchema), async (req: WithId, res) => {
  res.json(await updateEquipment(req.user!.sub, req.params.id, req.body));
});
// The item's bill: a photo or PDF in the form field "file"
router.put("/:id/bill", uploadSingleFile, async (req: WithId, res) => {
  res.json(await setEquipmentBill(req.user!.sub, req.params.id, req.file));
});
router.delete("/:id/bill", async (req: WithId, res) => {
  res.json(await removeEquipmentBill(req.user!.sub, req.params.id));
});
router.delete("/:id", async (req: WithId, res) => {
  res.json(await deleteEquipment(req.user!.sub, req.params.id));
});
router.post("/:id/moves", validate(moveSchema), async (req: WithMove, res) => {
  res.status(201).json(await addMove(req.user!.sub, req.params.id, req.body));
});
router.delete("/:id/moves/:moveId", async (req: WithMove, res) => {
  res.json(await undoMove(req.user!.sub, req.params.id, req.params.moveId));
});

// A hired item's cost changed: a new rate from a date, or a one-off amount (+ / −) charged to a site
router.post("/:id/hire-changes", validate(hireChangeSchema), async (req: WithId, res) => {
  res.status(201).json(await addHireChange(req.user!.sub, req.params.id, req.body));
});
router.delete("/:id/hire-changes/:changeId", async (req: Request<{ id: string; changeId: string }>, res) => {
  res.json(await removeHireChange(req.user!.sub, req.params.id, req.params.changeId));
});

export default router;