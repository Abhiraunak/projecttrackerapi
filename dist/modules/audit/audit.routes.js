import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { list, listCompany } from "./audit.controller.js";
// Mounted at /api/v1, so auth is added per route (a router-wide requireAuth would also block /auth/login).
// Both need the "See the activity log" permission (audit.view); the service checks it.
const router = Router();
router.get("/projects/:projectId/audit", requireAuth, list);
router.get("/audit", requireAuth, listCompany);
export default router;
//# sourceMappingURL=audit.routes.js.map