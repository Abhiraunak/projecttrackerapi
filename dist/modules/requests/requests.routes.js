import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createRequestSchema, decideSchema, issueSchema, orderFromRequestSchema } from "./requests.schema.js";
import * as c from "./requests.controller.js";
// Mounted at /api/v1. Permissions are checked in the service.
const router = Router();
router.get("/material-requests/pending-count", requireAuth, c.pending);
router.get("/projects/:projectId/material-requests", requireAuth, c.list);
router.post("/projects/:projectId/material-requests", requireAuth, validate(createRequestSchema), c.create);
router.post("/material-requests/:id/approve", requireAuth, validate(decideSchema), c.approve);
router.post("/material-requests/:id/reject", requireAuth, validate(decideSchema), c.reject);
router.post("/material-requests/:id/cancel", requireAuth, validate(decideSchema), c.cancel);
router.post("/material-requests/:id/issue", requireAuth, validate(issueSchema), c.issue);
router.post("/material-requests/:id/order", requireAuth, validate(orderFromRequestSchema), c.order);
export default router;
//# sourceMappingURL=requests.routes.js.map