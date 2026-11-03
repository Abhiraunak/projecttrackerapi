import { Router, type Request } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { requireFeature } from "../../lib/features.js";
import { createEquipmentSchema, moveSchema, updateEquipmentSchema } from "./equipment.schema.js";
import { addMove, createEquipment, getEquipment, listEquipment, undoMove, updateEquipment } from "./equipment.service.js";

/** Routes with an id in the path: the ids are always there (req.params is otherwise a loose dictionary) */
type WithId = Request<{ id: string }>;
type WithMove = Request<{ id: string; moveId: string }>;

/** Phase 6: the equipment register. Mounted at /api/v1/equipment. */
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
router.post("/:id/moves", validate(moveSchema), async (req: WithId, res) => {
  res.status(201).json(await addMove(req.user!.sub, req.params.id, req.body));
});
router.delete("/:id/moves/:moveId", async (req: WithMove, res) => {
  res.json(await undoMove(req.user!.sub, req.params.id, req.params.moveId));
});

export default router;