import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { archivedDeleteSchema, billPaymentSchema, billSchema, teamPaymentSchema, copyDaySchema, dayQuery, measureSchema, paymentSchema, periodPaymentSchema, personQuery, personSchema, progressSchema, quantitySchema, quoteSchema, rangeQuery, saveDaySchema, statementQuery, subPaymentSchema, workRateSchema, workSchema, } from "./labourSimple.schema.js";
import * as s from "./labourSimple.service.js";
/*
 * The simple Labour section. Mounted at /api/v1 (app.ts): app.use("/api/v1", labourSimpleRoutes).
 * Adding a payment with a receipt photo, and deleting a payment, use the existing /projects/:id/contractor-payments.
 */
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 1500, standardHeaders: "draft-7", legacyHeaders: false });
const router = Router();
const base = "/projects/:projectId/labour-simple";
const uid = (req) => req.user.sub;
// attendance
router.get(`${base}/day`, requireAuth, async (req, res) => res.json(await s.getDay(uid(req), req.params.projectId, dayQuery.parse(req.query))));
router.put(`${base}/day`, requireAuth, writeLimiter, validate(saveDaySchema), async (req, res) => res.json(await s.saveDay(uid(req), req.params.projectId, req.body)));
router.post(`${base}/copy`, requireAuth, writeLimiter, validate(copyDaySchema), async (req, res) => res.json(await s.copyDay(uid(req), req.params.projectId, req.body)));
router.get(`${base}/days`, requireAuth, async (req, res) => res.json(await s.dayTotals(uid(req), req.params.projectId, rangeQuery.parse(req.query))));
router.get(`${base}/records`, requireAuth, async (req, res) => res.json(await s.records(uid(req), req.params.projectId, rangeQuery.parse(req.query))));
router.get(`${base}/people`, requireAuth, async (req, res) => res.json(await s.people(uid(req), req.params.projectId)));
router.get(`${base}/works`, requireAuth, async (req, res) => res.json(await s.works(uid(req), req.params.projectId)));
router.post(`${base}/works`, requireAuth, writeLimiter, validate(workSchema), async (req, res) => res.status(201).json(await s.addWork(uid(req), req.params.projectId, req.body.title)));
router.patch(`${base}/works/:id`, requireAuth, writeLimiter, validate(workSchema), async (req, res) => res.json(await s.renameWork(uid(req), req.params.projectId, req.params.id, req.body.title)));
router.put(`${base}/works/:id/quantity`, requireAuth, writeLimiter, validate(quantitySchema), async (req, res) => res.json(await s.setQuantity(uid(req), req.params.projectId, req.params.id, req.body.quantity)));
// payments
router.get(`${base}/statement`, requireAuth, async (req, res) => res.json(await s.statement(uid(req), req.params.projectId, statementQuery.parse(req.query))));
router.put(`${base}/payments/:id`, requireAuth, writeLimiter, validate(paymentSchema), async (req, res) => res.json(await s.updatePayment(uid(req), req.params.projectId, req.params.id, req.body)));
// paid for a period (Attendance tab): a name, From – To and the amount
router.get(`${base}/period-payments`, requireAuth, async (req, res) => res.json(await s.periodPayments(uid(req), req.params.projectId)));
router.post(`${base}/period-payments`, requireAuth, writeLimiter, validate(periodPaymentSchema), async (req, res) => res.status(201).json(await s.addPeriodPayment(uid(req), req.params.projectId, req.body)));
router.put(`${base}/period-payments/:id`, requireAuth, writeLimiter, validate(periodPaymentSchema), async (req, res) => res.json(await s.updatePeriodPayment(uid(req), req.params.projectId, req.params.id, req.body)));
router.delete(`${base}/period-payments/:id`, requireAuth, async (req, res) => res.json(await s.removePeriodPayment(uid(req), req.params.projectId, req.params.id)));
// team heads and individuals (Attendance tab list): one row per person, their days and payments, archive
router.get(`${base}/team`, requireAuth, async (req, res) => res.json(await s.team(uid(req), req.params.projectId)));
router.get(`${base}/team/person`, requireAuth, async (req, res) => res.json(await s.person(uid(req), req.params.projectId, personQuery.parse(req.query).name)));
router.post(`${base}/team/archive`, requireAuth, writeLimiter, validate(personSchema), async (req, res) => res.json(await s.archivePerson(uid(req), req.params.projectId, req.body.name)));
router.post(`${base}/team/restore`, requireAuth, writeLimiter, validate(personSchema), async (req, res) => res.json(await s.restorePerson(uid(req), req.params.projectId, req.body.name)));
// bills: a period's amount for a team head or person, and payments made against it on a day
router.post(`${base}/bills`, requireAuth, writeLimiter, validate(billSchema), async (req, res) => res.status(201).json(await s.addBill(uid(req), req.params.projectId, req.body)));
router.put(`${base}/bills/:id`, requireAuth, writeLimiter, validate(billSchema), async (req, res) => res.json(await s.updateBill(uid(req), req.params.projectId, req.params.id, req.body)));
router.post(`${base}/bills/:id/archive`, requireAuth, writeLimiter, async (req, res) => res.json(await s.archiveBill(uid(req), req.params.projectId, req.params.id, true)));
router.post(`${base}/bills/:id/restore`, requireAuth, writeLimiter, async (req, res) => res.json(await s.archiveBill(uid(req), req.params.projectId, req.params.id, false)));
router.post(`${base}/bill-payments`, requireAuth, writeLimiter, validate(billPaymentSchema), async (req, res) => res.status(201).json(await s.addBillPayment(uid(req), req.params.projectId, req.body)));
router.put(`${base}/bill-payments/:id`, requireAuth, writeLimiter, validate(billPaymentSchema), async (req, res) => res.json(await s.updateBillPayment(uid(req), req.params.projectId, req.params.id, req.body)));
router.post(`${base}/team-payments`, requireAuth, writeLimiter, validate(teamPaymentSchema), async (req, res) => res.status(201).json(await s.addTeamPayment(uid(req), req.params.projectId, req.body)));
router.put(`${base}/team-payments/:id`, requireAuth, writeLimiter, validate(teamPaymentSchema), async (req, res) => res.json(await s.updateTeamPayment(uid(req), req.params.projectId, req.params.id, req.body)));
router.post(`${base}/payments/:id/to-bill`, requireAuth, writeLimiter, async (req, res) => res.json(await s.paymentToBill(uid(req), req.params.projectId, req.params.id)));
router.post(`${base}/payments/:id/archive`, requireAuth, writeLimiter, async (req, res) => res.json(await s.archivePayment(uid(req), req.params.projectId, req.params.id, true)));
router.post(`${base}/payments/:id/restore`, requireAuth, writeLimiter, async (req, res) => res.json(await s.archivePayment(uid(req), req.params.projectId, req.params.id, false)));
// subcontract: works with "done till date", payments for a work or as an advance, archive
router.get(`${base}/subcontract`, requireAuth, async (req, res) => res.json(await s.subcontract(uid(req), req.params.projectId)));
router.post(`${base}/subcontract`, requireAuth, writeLimiter, validate(measureSchema), async (req, res) => res.status(201).json(await s.addMeasure(uid(req), req.params.projectId, req.body)));
// (before /subcontract/:id so "payments" is never read as an id)
router.post(`${base}/subcontract/payments`, requireAuth, writeLimiter, validate(subPaymentSchema), async (req, res) => res.status(201).json(await s.addSubPayment(uid(req), req.params.projectId, req.body)));
router.put(`${base}/subcontract/payments/:id`, requireAuth, writeLimiter, validate(subPaymentSchema), async (req, res) => res.json(await s.updateSubPayment(uid(req), req.params.projectId, req.params.id, req.body)));
router.put(`${base}/subcontract/:id`, requireAuth, writeLimiter, validate(measureSchema), async (req, res) => res.json(await s.updateMeasure(uid(req), req.params.projectId, req.params.id, req.body)));
router.post(`${base}/subcontract/:id/progress`, requireAuth, writeLimiter, validate(progressSchema), async (req, res) => res.status(201).json(await s.addProgress(uid(req), req.params.projectId, req.params.id, req.body)));
router.put(`${base}/progress/:id`, requireAuth, writeLimiter, validate(progressSchema), async (req, res) => res.json(await s.updateProgress(uid(req), req.params.projectId, req.params.id, req.body)));
router.post(`${base}/subcontract/:id/archive`, requireAuth, writeLimiter, async (req, res) => res.json(await s.archiveMeasure(uid(req), req.params.projectId, req.params.id, true)));
router.post(`${base}/subcontract/:id/restore`, requireAuth, writeLimiter, async (req, res) => res.json(await s.archiveMeasure(uid(req), req.params.projectId, req.params.id, false)));
router.delete(`${base}/subcontract/:id`, requireAuth, async (req, res) => res.json(await s.removeMeasure(uid(req), req.params.projectId, req.params.id)));
router.post(`${base}/subcontractors/archive`, requireAuth, writeLimiter, validate(personSchema), async (req, res) => res.json(await s.archiveSubcontractor(uid(req), req.params.projectId, req.body.name, true)));
router.post(`${base}/subcontractors/restore`, requireAuth, writeLimiter, validate(personSchema), async (req, res) => res.json(await s.archiveSubcontractor(uid(req), req.params.projectId, req.body.name, false)));
// archived: the list, and delete for good (only what was archived first)
router.get(`${base}/archived`, requireAuth, async (req, res) => res.json(await s.archived(uid(req), req.params.projectId)));
router.post(`${base}/archived/delete`, requireAuth, writeLimiter, validate(archivedDeleteSchema), async (req, res) => res.json(await s.deleteArchived(uid(req), req.params.projectId, req.body)));
// rate comparison: the table (one row per work), and a work's quantity done and contractor rate
router.get(`${base}/rates`, requireAuth, async (req, res) => res.json(await s.rateTable(uid(req), req.params.projectId, rangeQuery.parse(req.query))));
router.put(`${base}/works/:id/rate`, requireAuth, writeLimiter, validate(workRateSchema), async (req, res) => res.json(await s.setWorkRate(uid(req), req.params.projectId, req.params.id, req.body)));
// (older: one work against several quotes; kept so nothing breaks, the page no longer uses it)
router.get(`${base}/compare`, requireAuth, async (req, res) => res.json(await s.compare(uid(req), req.params.projectId, rangeQuery.parse(req.query))));
router.post(`${base}/works/:id/quotes`, requireAuth, writeLimiter, validate(quoteSchema), async (req, res) => res.status(201).json(await s.addQuote(uid(req), req.params.projectId, req.params.id, req.body)));
router.put(`${base}/quotes/:id`, requireAuth, writeLimiter, validate(quoteSchema), async (req, res) => res.json(await s.updateQuote(uid(req), req.params.projectId, req.params.id, req.body)));
router.delete(`${base}/quotes/:id`, requireAuth, async (req, res) => res.json(await s.removeQuote(uid(req), req.params.projectId, req.params.id)));
export default router;
//# sourceMappingURL=labourSimple.routes.js.map