import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { me } from "./access.controller.js";
// Mounted at /api/v1, so auth is added per route (a router-wide requireAuth would also block /auth/login)
const router = Router();
router.get("/me/access", requireAuth, me);
export default router;
//# sourceMappingURL=access.routes.js.map