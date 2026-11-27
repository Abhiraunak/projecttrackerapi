import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { z } from "zod";
import { list, listCompany } from "./audit.controller.js";
import { listActivity } from "./audit.service.js";

const activityQuery = z.object({
    projectId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    // Recent activity panel: only the last N days, and one kind of change
    days: z.coerce.number().int().min(1).max(90).optional(),
    type: z.enum(["materials", "labour", "payments", "projects"]).optional(),
});

// Mounted at /api/v1, so auth is added per route (a router-wide requireAuth would also block /auth/login).
// Both need the "See the activity log" permission (audit.view); the service checks it.
const router = Router();
router.get("/projects/:projectId/audit", requireAuth, list);
router.get("/audit", requireAuth, listCompany);
// The Activity feed in the bell: everything, newest first; ?projectId= for one project
router.get("/activity", requireAuth, async (req, res) => {
    res.json(await listActivity(req.user!.sub, activityQuery.parse(req.query)));
});

export default router;