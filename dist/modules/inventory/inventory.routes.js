import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createMovementSchema } from "./inventory.schema.js";
import * as c from "./inventory.controller.js";
// Mounted at /api/v1, so auth is added per route (a router-wide requireAuth would also block /auth/login)
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: "draft-7", legacyHeaders: false });
const router = Router();
router.get("/projects/:projectId/inventory", requireAuth, c.inventory);
router.get("/projects/:projectId/stock-movements", requireAuth, c.movements);
router.post("/projects/:projectId/stock-movements", requireAuth, writeLimiter, validate(createMovementSchema), c.record);
export default router;
//# sourceMappingURL=inventory.routes.js.map