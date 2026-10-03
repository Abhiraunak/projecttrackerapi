import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { createProjectSchema, updateProjectSchema, patchProjectSchema, patchTaskSchema, } from "./projects.schema.js";
import * as c from "./projects.controller.js";
const router = Router();
router.use(requireAuth);
router.get("/", c.list);
router.post("/", validate(createProjectSchema), c.create);
router.get("/:id", c.getOne);
router.put("/:id", validate(updateProjectSchema), c.update);
router.patch("/:id", validate(patchProjectSchema), c.patchProject);
router.delete("/:id", c.remove);
router.patch("/:id/tasks/:taskId", validate(patchTaskSchema), c.patchTask);
export default router;
//# sourceMappingURL=projects.routes.js.map