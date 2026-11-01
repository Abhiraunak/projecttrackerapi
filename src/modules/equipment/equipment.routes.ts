import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { requireFeature } from "../../lib/features.js";
import { createEquipmentSchema, moveSchema, updateEquipmentSchema } from "./equipment.schema.js";
import { addMove, createEquipment, getEquipment, listEquipment, undoMove, updateEquipment } from "./equipment.service.js";

/** Phase 6: the equipment register (FEATURES=equipment). Mounted at /api/v1/equipment. */
const router = Router();
router.use(requireAuth, requireFeature("equipment"));

router.get("/", async (req, res) => {
  res.json(await listEquipment(req.user!.sub));
});
router.post("/", validate(createEquipmentSchema), async (req, res) => {
  res.status(201).json(await createEquipment(req.user!.sub, req.body));
});
router.get("/:id", async (req, res) => {
  res.json(await getEquipment(req.user!.sub, req.params.id));
});
router.patch("/:id", validate(updateEquipmentSchema), async (req, res) => {
  res.json(await updateEquipment(req.user!.sub, req.params.id, req.body));
});
router.post("/:id/moves", validate(moveSchema), async (req, res) => {
  res.status(201).json(await addMove(req.user!.sub, req.params.id, req.body));
});
router.delete("/:id/moves/:moveId", async (req, res) => {
  res.json(await undoMove(req.user!.sub, req.params.id, req.params.moveId));
});

export default router;
