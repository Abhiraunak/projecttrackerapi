import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createOrderSchema, updateOrderSchema } from "./orders.schema.js";
import * as c from "./orders.controller.js";
// Mounted at /api/v1. Permissions are checked in the service, per project.
const router = Router();
router.get("/projects/:projectId/orders", requireAuth, c.list);
router.post("/projects/:projectId/orders", requireAuth, validate(createOrderSchema), c.create);
router.patch("/orders/:id", requireAuth, validate(updateOrderSchema), c.update);
router.delete("/orders/:id", requireAuth, c.remove);
export default router;
//# sourceMappingURL=orders.routes.js.map