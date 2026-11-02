import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { HttpError } from "../../lib/error.js";
import { adminOnly } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { uploadSingleFile } from "../../middleware/uploadImage.js";
import { addClientSchema, advanceSchema, createInstalmentSchema, decideSchema, delaySchema, proofSchema, recordPaymentSchema, updateInstalmentSchema, } from "./client.schema.js";
import * as c from "./client.controller.js";
/** Client accounts only (staff use the admin page instead) */
const clientOnly = (req, _res, next) => req.user?.role === "CLIENT" ? next() : next(new HttpError(403, "This page is for clients."));
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
/**
 * Mounted at /api/v1.
 *   /client/…        the client portal: client accounts only, and only their own projects (checked in the service)
 *   /invoices/:id     an invoice: the project's client, or an admin
 *   /client-admin/…   the admin's client and payments page: admins only
 */
const router = Router();
// Client portal
router.get("/client/projects", requireAuth, clientOnly, c.projects);
router.get("/client/projects/:id", requireAuth, clientOnly, c.portal);
router.post("/client/instalments/:id/proofs", requireAuth, clientOnly, uploadLimiter, uploadSingleFile, validate(proofSchema), c.sendProof);
router.get("/client/invoices/:id", requireAuth, c.getInvoice); // the client or an admin: the service checks which
// Admin
const admin = Router();
admin.use(requireAuth, adminOnly);
admin.get("/overview", c.overview);
admin.get("/projects/:id", c.project);
admin.post("/projects/:id/clients", validate(addClientSchema), c.addProjectClient);
admin.delete("/projects/:id/clients/:userId", c.removeProjectClient);
admin.post("/clients/:userId/reset-password", c.resetPassword);
admin.post("/projects/:id/instalments", validate(createInstalmentSchema), c.addInstalment);
admin.patch("/instalments/:id", validate(updateInstalmentSchema), c.editInstalment);
admin.delete("/instalments/:id", c.removeInstalment);
admin.post("/instalments/:id/request", c.askForPayment);
admin.post("/instalments/:id/payments", validate(recordPaymentSchema), c.addPayment);
admin.post("/proofs/:id/approve", validate(decideSchema), c.approveProof);
admin.post("/proofs/:id/reject", validate(decideSchema), c.rejectProof);
admin.patch("/projects/:id/advance", validate(advanceSchema), c.advance);
admin.post("/projects/:id/delays", validate(delaySchema), c.delay);
router.use("/client-admin", admin);
export default router;
//# sourceMappingURL=client.routes.js.map