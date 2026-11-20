import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createEquipmentSchema, hireChangeSchema, moveSchema, updateEquipmentSchema } from "./equipment.schema.js";
import { addHireChange, addMove, createEquipment, getEquipment, listEquipment, removeHireChange, undoMove, updateEquipment } from "./equipment.service.js";
const router = Router();
router.use(requireAuth);
router.get("/", async (req, res) => {
    res.json(await listEquipment(req.user.sub));
});
router.post("/", validate(createEquipmentSchema), async (req, res) => {
    res.status(201).json(await createEquipment(req.user.sub, req.body));
});
router.get("/:id", async (req, res) => {
    res.json(await getEquipment(req.user.sub, req.params.id));
});
router.patch("/:id", validate(updateEquipmentSchema), async (req, res) => {
    res.json(await updateEquipment(req.user.sub, req.params.id, req.body));
});
router.post("/:id/moves", validate(moveSchema), async (req, res) => {
    res.status(201).json(await addMove(req.user.sub, req.params.id, req.body));
});
router.delete("/:id/moves/:moveId", async (req, res) => {
    res.json(await undoMove(req.user.sub, req.params.id, req.params.moveId));
});
// A hired item's cost changed: a new rate from a date, or a one-off amount (+ / −) charged to a site
router.post("/:id/hire-changes", validate(hireChangeSchema), async (req, res) => {
    res.status(201).json(await addHireChange(req.user.sub, req.params.id, req.body));
});
router.delete("/:id/hire-changes/:changeId", async (req, res) => {
    res.json(await removeHireChange(req.user.sub, req.params.id, req.params.changeId));
});
export default router;
//# sourceMappingURL=equipment.routes.js.map