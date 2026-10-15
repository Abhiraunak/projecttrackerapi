import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { search } from "./users.controller.js";
const router = Router();
router.get("/", requireAuth, search);
export default router;
//# sourceMappingURL=users.routes.js.map