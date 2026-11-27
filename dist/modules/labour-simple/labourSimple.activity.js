import { prisma } from "../../lib/prisma.js";
import { recordAudit } from "../audit/audit.service.js";
const inr = (v) => `₹${Math.round(Number(v) || 0).toLocaleString("en-IN")}`;
const day = (v) => {
    const s = String(v ?? "");
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
};
const who = (b) => String(b.name ?? b.contractorName ?? "").trim();
/** What a Labour save says in the log, from its method, path (after /labour-simple) and body */
function lineFor(method, path, b) {
    const is = (m, re) => method === m && re.test(path);
    const att = (action, summary) => ({ action, entityType: "attendance", summary });
    const pay = (action, summary) => ({ action, entityType: "payment", summary });
    if (is("PUT", /^\/day$/)) {
        const n = Array.isArray(b.workers) ? b.workers.length : 0;
        return att("labour.attendance_saved", `Marked attendance · ${who(b)} · ${day(b.date)}${n ? ` · ${n} labour` : ""}`);
    }
    if (is("POST", /^\/copy$/)) {
        const n = Array.isArray(b.dates) ? b.dates.length : 0;
        return att("labour.attendance_copied", `Copied attendance · ${who(b)} · ${day(b.date)} to ${n} ${n === 1 ? "day" : "days"}`);
    }
    if (is("POST", /^\/bills$/))
        return pay("labour.bill_added", `Added a bill · ${who(b)} · ${day(b.from)} – ${day(b.to)} · ${inr(b.amount)}`);
    if (is("PUT", /^\/bills\/[^/]+$/))
        return pay("labour.bill_changed", `Changed a bill · ${who(b)} · ${inr(b.amount)}`);
    if (is("POST", /^\/bills\/[^/]+\/archive$/))
        return pay("labour.bill_archived", "Archived a labour bill");
    if (is("POST", /^\/bills\/[^/]+\/restore$/))
        return pay("labour.bill_restored", "Restored a labour bill");
    if (is("POST", /^\/(team-payments|bill-payments)$/))
        return pay("labour.paid", `Paid ${who(b) || "labour"} · ${inr(b.amount)} · ${day(b.date)}`);
    if (is("PUT", /^\/(team-payments|bill-payments|payments)\/[^/]+$/))
        return pay("labour.payment_changed", `Changed a labour payment${who(b) ? ` · ${who(b)}` : ""} · ${inr(b.amount)}`);
    if (is("POST", /^\/payments\/[^/]+\/archive$/))
        return pay("labour.payment_archived", "Archived a labour payment");
    if (is("POST", /^\/payments\/[^/]+\/restore$/))
        return pay("labour.payment_restored", "Restored a labour payment");
    if (is("POST", /^\/team\/archive$/))
        return att("labour.person_archived", `Archived ${who(b)} with their days, bills and payments`);
    if (is("POST", /^\/team\/restore$/))
        return att("labour.person_restored", `Restored ${who(b)}`);
    if (is("POST", /^\/subcontract$/))
        return att("labour.work_added", `Added subcontract work · ${who(b)} · ${String(b.work ?? "")} · ${b.quantity} ${b.unit ?? ""} at ${inr(b.rate)}`);
    if (is("PUT", /^\/subcontract\/[^/]+$/))
        return att("labour.work_changed", `Changed subcontract work · ${who(b)} · ${String(b.work ?? "")}`);
    if (is("POST", /^\/subcontract\/[^/]+\/progress$/) || is("PUT", /^\/progress\/[^/]+$/))
        return att("labour.work_done", `Updated work done till date · ${b.done} · ${day(b.date)}`);
    if (is("POST", /^\/subcontract\/payments$/))
        return pay("labour.subcontract_paid", `Paid subcontractor ${who(b)} · ${inr(b.amount)} · ${day(b.date)}`);
    if (is("PUT", /^\/subcontract\/payments\/[^/]+$/))
        return pay("labour.subcontract_payment_changed", `Changed a subcontractor payment · ${who(b)} · ${inr(b.amount)}`);
    if (is("POST", /^\/subcontract\/[^/]+\/archive$/))
        return att("labour.work_archived", "Archived subcontract work");
    if (is("POST", /^\/subcontractors\/archive$/))
        return att("labour.subcontractor_archived", `Archived subcontractor ${who(b)}`);
    if (is("POST", /^\/archived\/delete$/) || is("DELETE", /^\/subcontract\/[^/]+$/))
        return att("labour.deleted", "Deleted archived labour entries for good");
    if (is("POST", /^\/works$/))
        return att("labour.work_item_added", `Added work item · ${String(b.title ?? "")}`);
    if (is("PATCH", /^\/works\/[^/]+$/))
        return att("labour.work_item_renamed", `Renamed a work item to ${String(b.title ?? "")}`);
    if (method !== "GET")
        return att("labour.rates_changed", "Changed labour rate comparison");
    return null;
}
/** Mount on the Labour routes with router.use(base, logLabourActivity) */
export const logLabourActivity = (req, res, next) => {
    if (req.method === "GET")
        return next();
    const projectId = req.params.projectId;
    const path = req.path; // read now: after this step Express gives back the full address
    res.on("finish", () => {
        const actorId = req.user?.sub;
        if (!actorId || res.statusCode >= 400)
            return;
        const line = lineFor(req.method, path, (req.body ?? {}));
        if (!line)
            return;
        recordAudit(prisma, { projectId, actorId, ...line }).catch(() => { }); // the log must never break the save
    });
    next();
};
//# sourceMappingURL=labourSimple.activity.js.map