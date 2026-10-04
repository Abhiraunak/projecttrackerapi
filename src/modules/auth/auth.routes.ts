import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireCsrfHeader } from "../../middleware/csrf.js";
import { registerSchema, loginSchema } from "./auth.schema.js";
import * as c from "./auth.controller.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// Refresh happens in the background for every user, so it needs a much roomier limit than login
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const router = Router();
router.post("/register", authLimiter, validate(registerSchema), c.register);
router.post("/login", authLimiter, validate(loginSchema), c.login);
router.post("/refresh", refreshLimiter, requireCsrfHeader, c.refresh);
router.post("/logout", c.logout);
router.post("/logout-all", requireAuth, c.logoutAll);
router.get("/me", requireAuth, c.me);

export default router;