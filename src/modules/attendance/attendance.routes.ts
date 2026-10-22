import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as c from "./attendance.controller.js";
import { createAttendanceSchema, createManyAttendanceSchema, updateAttendanceSchema } from "./atttendance.schema.js";

const router = Router();
router.use(requireAuth);

router.get("/", c.list);
router.post("/", validate(createAttendanceSchema), c.create);
router.post("/bulk", validate(createManyAttendanceSchema), c.createMany); // several days at once
router.put("/:id", validate(updateAttendanceSchema), c.update);
router.delete("/:id", c.remove);

export default router;
