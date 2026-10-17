import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createRequirementSchema, updateOrderSchema } from "./requirements.schema.js";
import * as c from "./requirements.controller.js";
const router = Router();
router.get("/projects/:projectId/requirements", requireAuth, c.list);
router.post("/projects/:projectId/requirements", requireAuth, validate(createRequirementSchema), c.create);
router.patch("/requirements/:id/order", requireAuth, validate(updateOrderSchema), c.order);
router.delete("/requirements/:id", requireAuth, c.remove);
export default router;
//# sourceMappingURL=requirements.routes.js.map