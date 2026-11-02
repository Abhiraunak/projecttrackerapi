import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createAttendanceSchema, createManyAttendanceSchema, setTradeSchema, updateAttendanceSchema } from "./atttendance.schema.js";
import * as c from "./attendance.controller.js";
const router = Router();
router.use(requireAuth);
router.get("/", c.list);
router.get("/trades", c.trades); // per-trade totals, the trades to offer, each contractor's usual trade
router.patch("/trade", validate(setTradeSchema), c.setTrade); // give a contractor's entries a trade in one go
router.post("/", validate(createAttendanceSchema), c.create);
router.post("/bulk", validate(createManyAttendanceSchema), c.createMany); // several days at once
router.put("/:id", validate(updateAttendanceSchema), c.update);
router.delete("/:id", c.remove);
export default router;
//# sourceMappingURL=attendance.routes.js.map