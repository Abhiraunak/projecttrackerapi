import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as c from "./dashboard.controller.js";
// Mounted at /api/v1. Admins only: the service checks it.
const router = Router();
router.get("/dashboard/overview", requireAuth, c.overview);
export default router;
//# sourceMappingURL=dashboard.routes.js.map