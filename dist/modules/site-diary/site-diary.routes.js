import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { uploadSingleFile } from "../../middleware/uploadImage.js";
import { HttpError } from "../../lib/error.js";
import { listQuery, mineQuery, photoSchema, rateSchema, reportSchema, siteSchema, toAttendanceSchema } from "./site-diary.schema.js";
import * as s from "./site-diary.service.js";
/*
 * Mounted at /api/v1/site-diary (app.ts). Every handler's service checks the permission it needs:
 * "diary.write" for the engineer's routes, "diary.review" for the manager's.
 */
const router = Router();
router.use(requireAuth);
// Photos: a few per entry, a few entries a day. Anything like this many is a stuck retry loop.
const photoLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
const saveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });
const idParam = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const param = (req, name) => {
    const v = idParam.safeParse(req.params[name]);
    if (!v.success)
        throw new HttpError(404, "Not found");
    return v.data;
};
/* ------------------------------ site engineer ------------------------------ */
router.get("/projects", async (req, res) => {
    res.json({ projects: await s.engineerProjects(req.user.sub) });
});
/** Teams and materials to pick from on one project */
router.get("/projects/:projectId/setup", async (req, res) => {
    res.json(await s.engineerSetup(req.user.sub, param(req, "projectId")));
});
/** The engineer's own report for a day, or null */
router.get("/mine", async (req, res) => {
    const q = mineQuery.parse(req.query);
    res.json({ report: await s.myReport(req.user.sub, q.projectId, q.date) });
});
/** Send the day's report (again, to change it the same day) */
router.put("/reports", saveLimiter, validate(reportSchema), async (req, res) => {
    res.json({ report: await s.saveReport(req.user.sub, req.body) });
});
/** One photo of material that arrived: multipart, the photo in "file" */
router.post("/arrivals/:arrivalId/photos", photoLimiter, uploadSingleFile, validate(photoSchema), async (req, res) => {
    if (!req.file)
        throw new HttpError(400, "Take the photo first.");
    res.status(201).json({ photo: await s.addPhoto(req.user.sub, param(req, "arrivalId"), req.body, req.file) });
});
/* --------------------------------- manager --------------------------------- */
router.get("/projects/:projectId/reports", async (req, res) => {
    const { month } = listQuery.parse(req.query);
    res.json(await s.listReports(req.user.sub, param(req, "projectId"), month));
});
router.get("/reports/:reportId", async (req, res) => {
    res.json({ report: await s.getReport(req.user.sub, param(req, "reportId")) });
});
router.get("/projects/:projectId/site", async (req, res) => {
    res.json({ site: await s.getSite(req.user.sub, param(req, "projectId")) });
});
router.put("/projects/:projectId/site", validate(siteSchema), async (req, res) => {
    res.json({ site: await s.setSite(req.user.sub, param(req, "projectId"), req.body) });
});
/** A team's day into Labour attendance, at the manager's rates */
router.post("/teams/:teamId/attendance", validate(toAttendanceSchema), async (req, res) => {
    res.status(201).json(await s.teamToAttendance(req.user.sub, param(req, "teamId"), req.body));
});
/** The rate of material that arrived (and which material it is, when it wasn't picked on site) */
router.put("/arrivals/:arrivalId/rate", validate(rateSchema), async (req, res) => {
    const body = req.body;
    res.json(await s.priceArrival(req.user.sub, param(req, "arrivalId"), body.rate, body.purchaseId));
});
export default router;
//# sourceMappingURL=site-diary.routes.js.map