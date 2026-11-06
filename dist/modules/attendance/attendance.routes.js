import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createAttendanceSchema, createManyAttendanceSchema, setTradeSchema, updateAttendanceSchema } from "./atttendance.schema.js";
import * as c from "./attendance.controller.js";
import { getMonth, getTeam, saveTeam } from "./attendance.team.js";
const router = Router();
router.use(requireAuth);
router.get("/", c.list);
router.get("/trades", c.trades); // per-trade totals, the trades to offer, each contractor's usual trade
router.get("/team", getTeam); // a contractor's labourers and day rates (hourly attendance)
router.put("/team", saveTeam); // names, day rates, who left
router.get("/month", getMonth); // month sheet (labourers × days, hours, OT, totals) and the month's account
router.patch("/trade", validate(setTradeSchema), c.setTrade); // give a contractor's entries a trade in one go
router.post("/", validate(createAttendanceSchema), c.create);
router.post("/bulk", validate(createManyAttendanceSchema), c.createMany); // several days at once
router.put("/bulk/:batchId", validate(createManyAttendanceSchema), c.updateBatch); // edit days saved together, in one go
router.delete("/bulk/:batchId", c.removeBatch); // delete days saved together
router.put("/:id", validate(updateAttendanceSchema), c.update);
router.delete("/:id", c.remove);
export default router;
//# sourceMappingURL=attendance.routes.js.map