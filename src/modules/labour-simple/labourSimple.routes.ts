import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { copyDaySchema, dayQuery, measureSchema, paymentSchema, quantitySchema, quoteSchema, rangeQuery, saveDaySchema, statementQuery, workRateSchema, workSchema } from "./labourSimple.schema.js";
import * as s from "./labourSimple.service.js";

/*
 * The simple Labour section. Mounted at /api/v1 (app.ts): app.use("/api/v1", labourSimpleRoutes).
 * Adding a payment with a receipt photo, and deleting a payment, use the existing /projects/:id/contractor-payments.
 */
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 1500, standardHeaders: "draft-7", legacyHeaders: false });
const router = Router();
type P = Request<{ projectId: string }>;
type PI = Request<{ projectId: string; id: string }>;
const base = "/projects/:projectId/labour-simple";
const uid = (req: Request) => req.user!.sub;

// attendance
router.get(`${base}/day`, requireAuth, async (req: P, res) => res.json(await s.getDay(uid(req), req.params.projectId, dayQuery.parse(req.query))));
router.put(`${base}/day`, requireAuth, writeLimiter, validate(saveDaySchema), async (req: P, res) => res.json(await s.saveDay(uid(req), req.params.projectId, req.body)));
router.post(`${base}/copy`, requireAuth, writeLimiter, validate(copyDaySchema), async (req: P, res) => res.json(await s.copyDay(uid(req), req.params.projectId, req.body)));
router.get(`${base}/days`, requireAuth, async (req: P, res) => res.json(await s.dayTotals(uid(req), req.params.projectId, rangeQuery.parse(req.query))));
router.get(`${base}/records`, requireAuth, async (req: P, res) => res.json(await s.records(uid(req), req.params.projectId, rangeQuery.parse(req.query))));
router.get(`${base}/people`, requireAuth, async (req: P, res) => res.json(await s.people(uid(req), req.params.projectId)));
router.get(`${base}/works`, requireAuth, async (req: P, res) => res.json(await s.works(uid(req), req.params.projectId)));
router.post(`${base}/works`, requireAuth, writeLimiter, validate(workSchema), async (req: P, res) => res.status(201).json(await s.addWork(uid(req), req.params.projectId, req.body.title)));
router.patch(`${base}/works/:id`, requireAuth, writeLimiter, validate(workSchema), async (req: PI, res) => res.json(await s.renameWork(uid(req), req.params.projectId, req.params.id, req.body.title)));
router.put(`${base}/works/:id/quantity`, requireAuth, writeLimiter, validate(quantitySchema), async (req: PI, res) =>
  res.json(await s.setQuantity(uid(req), req.params.projectId, req.params.id, req.body.quantity)),
);

// payments
router.get(`${base}/statement`, requireAuth, async (req: P, res) => res.json(await s.statement(uid(req), req.params.projectId, statementQuery.parse(req.query))));
router.put(`${base}/payments/:id`, requireAuth, writeLimiter, validate(paymentSchema), async (req: PI, res) => res.json(await s.updatePayment(uid(req), req.params.projectId, req.params.id, req.body)));

// subcontract
router.get(`${base}/subcontract`, requireAuth, async (req: P, res) => res.json(await s.subcontract(uid(req), req.params.projectId)));
router.post(`${base}/subcontract`, requireAuth, writeLimiter, validate(measureSchema), async (req: P, res) => res.status(201).json(await s.addMeasure(uid(req), req.params.projectId, req.body)));
router.put(`${base}/subcontract/:id`, requireAuth, writeLimiter, validate(measureSchema), async (req: PI, res) => res.json(await s.updateMeasure(uid(req), req.params.projectId, req.params.id, req.body)));
router.delete(`${base}/subcontract/:id`, requireAuth, async (req: PI, res) => res.json(await s.removeMeasure(uid(req), req.params.projectId, req.params.id)));

// rate comparison: the table (one row per work), and a work's quantity done and contractor rate
router.get(`${base}/rates`, requireAuth, async (req: P, res) => res.json(await s.rateTable(uid(req), req.params.projectId, rangeQuery.parse(req.query))));
router.put(`${base}/works/:id/rate`, requireAuth, writeLimiter, validate(workRateSchema), async (req: PI, res) =>
  res.json(await s.setWorkRate(uid(req), req.params.projectId, req.params.id, req.body)),
);
// (older: one work against several quotes; kept so nothing breaks, the page no longer uses it)
router.get(`${base}/compare`, requireAuth, async (req: P, res) => res.json(await s.compare(uid(req), req.params.projectId, rangeQuery.parse(req.query))));
router.post(`${base}/works/:id/quotes`, requireAuth, writeLimiter, validate(quoteSchema), async (req: PI, res) => res.status(201).json(await s.addQuote(uid(req), req.params.projectId, req.params.id, req.body)));
router.put(`${base}/quotes/:id`, requireAuth, writeLimiter, validate(quoteSchema), async (req: PI, res) => res.json(await s.updateQuote(uid(req), req.params.projectId, req.params.id, req.body)));
router.delete(`${base}/quotes/:id`, requireAuth, async (req: PI, res) => res.json(await s.removeQuote(uid(req), req.params.projectId, req.params.id)));

export default router;