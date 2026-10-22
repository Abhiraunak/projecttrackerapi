import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { allow } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { uploadSingleFile } from "../../middleware/uploadImage.js";
import { createDrawingSchema, shareDrawingSchema } from "./drawings.schema.js";
import * as c from "./drawings.controller.js";

// Uploads are the expensive request: allow far fewer of them than normal calls
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const router = Router();
router.use(requireAuth, allow("drawings.use"));

router.get("/", c.list);
router.post("/", uploadLimiter, uploadSingleFile, validate(createDrawingSchema), c.create);
router.put("/:id/shares", validate(shareDrawingSchema), c.share);
router.delete("/:id", c.remove);

export default router;
