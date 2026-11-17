import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireCsrfHeader } from "../../middleware/csrf.js";
import { registerSchema, loginSchema } from "./auth.schema.js";
import * as c from "./auth.controller.js";
import { changeSchema, forgotSchema, resetSchema, verifySchema } from "../password-reset/password-reset.schema.js";
import * as pw from "../password-reset/password-reset.service.js";

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

/*
 * Forgot password: two limits on each step, by network address (stops one machine hammering) and by email
 * (stops many machines flooding one inbox or guessing one account's code). Counted in memory per server.
 */
const limit = (minutes: number, max: number, by: "ip" | "email" = "ip") =>
  rateLimit({
    windowMs: minutes * 60 * 1000,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many tries. Wait a few minutes and try again." },
    ...(by === "email" ? { keyGenerator: (req) => `email:${String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254)}` } : {}),
  });
const forgotByIp = limit(15, 5);
const forgotByEmail = limit(60, 3, "email");
const verifyByIp = limit(15, 15);
const verifyByEmail = limit(15, 10, "email");
const resetByIp = limit(15, 10);
const changeByIp = limit(15, 5);

const router = Router();
router.post("/register", authLimiter, validate(registerSchema), c.register);
router.post("/login", authLimiter, validate(loginSchema), c.login);
router.post("/refresh", refreshLimiter, requireCsrfHeader, c.refresh);
router.post("/logout", c.logout);
router.post("/logout-all", requireAuth, c.logoutAll);
router.get("/me", requireAuth, c.me);

// Forgot password (signed out): email → 6-digit code → new password
router.post("/password/forgot", forgotByIp, validate(forgotSchema), forgotByEmail, async (req, res) => {
  res.json(await pw.forgot(req, forgotSchema.parse({ body: req.body }).body));
});
router.post("/password/verify", verifyByIp, validate(verifySchema), verifyByEmail, async (req, res) => {
  res.json(await pw.verify(verifySchema.parse({ body: req.body }).body));
});
router.post("/password/reset", resetByIp, validate(resetSchema), async (req, res) => {
  res.json(await pw.reset(resetSchema.parse({ body: req.body }).body));
});
// Change password (signed in): the current password + a new one
router.post("/password/change", changeByIp, requireAuth, requireCsrfHeader, validate(changeSchema), async (req, res) => {
  res.json(await pw.change(req, res, req.user!.sub, changeSchema.parse({ body: req.body }).body));
});

export default router;