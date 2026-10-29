import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { listAllAlerts, listProjectAlerts, refreshAlerts } from "./alerts.service.js";
import { requirePermission } from "../../lib/projectAccess.js";
// Mounted at /api/v1
const router = Router();
const uid = (req) => req.user.sub;
router.get("/stock-alerts", requireAuth, async (req, res) => {
    res.json({ alerts: await listAllAlerts(uid(req)) });
});
router.get("/projects/:projectId/stock-alerts", requireAuth, async (req, res) => {
    res.json({ alerts: await listProjectAlerts(uid(req), req.params.projectId) });
});
/** "Check now": brings one project's alerts up to date at once (otherwise after each change and every 3 hours) */
router.post("/projects/:projectId/stock-alerts/refresh", requireAuth, async (req, res) => {
    await requirePermission(uid(req), req.params.projectId, "materials.view");
    await refreshAlerts(req.params.projectId);
    res.json({ alerts: await listProjectAlerts(uid(req), req.params.projectId) });
});
export default router;
//# sourceMappingURL=alerts.routes.js.map