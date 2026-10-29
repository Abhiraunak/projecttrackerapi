import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { allow } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createBoqSchema, saveBoqSchema, setProjectSchema } from "./boqs.schema.js";
import * as c from "./boqs.controller.js";
// Mounted at /api/v1/boqs: everyone here must be signed in and have the BOQ permission
const router = Router();
router.use(requireAuth, allow("boq.use"));
router.get("/", c.list);
router.post("/", validate(createBoqSchema), c.create);
router.get("/:id", c.getOne);
router.put("/:id", validate(saveBoqSchema), c.save);
router.post("/:id/duplicate", c.duplicate);
router.put("/:id/project", validate(setProjectSchema), c.setProject);
router.delete("/:id", c.remove);
export default router;
//# sourceMappingURL=boqs.routes.js.map