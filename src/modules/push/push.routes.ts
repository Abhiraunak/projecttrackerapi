import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { subscribeSchema, unsubscribeSchema } from "./push.schema.js";
import * as c from "./push.controller.js";

// Test messages go to real phones: a handful per hour is plenty
const testLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });

// Mounted at /api/v1/push
const router = Router();
router.use(requireAuth);

router.get("/config", c.config);
router.put("/subscription", validate(subscribeSchema), c.subscribe);
router.delete("/subscription", validate(unsubscribeSchema), c.unsubscribe);
router.post("/test", testLimiter, c.test);

export default router;
