import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { adminOnly } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { updateAccessSchema } from "./admin.schema.js";
import * as c from "./admin.controller.js";
// Mounted at /api/v1/admin: every route needs a signed-in admin
const router = Router();
router.use(requireAuth, adminOnly);
router.get("/users", c.users);
router.put("/users/:id/access", validate(updateAccessSchema), c.setAccess);
export default router;
//# sourceMappingURL=admin.routes.js.map