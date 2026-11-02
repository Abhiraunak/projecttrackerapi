import { prisma } from "../../lib/prisma.js";
import { logger } from "../../config/logger.js";
import { adminIds, clientIds, notify, notifyLater, purgeOldNotifications } from "../notifications/notifications.service.js";
import { paymentReminders } from "./client.calc.js";
import { projectSnapshot } from "./client.snapshot.js";
/**
 * Who hears about what, in the client portal:
 *
 *   to the client                                  to the admins
 *   - the advance is asked for                      - a client sent a payment to check
 *   - a payment is asked for, or falls due          - a payment sent over a day ago is still unchecked
 *   - a payment is due in 3 days                    - a client's payment is overdue (then weekly)
 *   - a payment is overdue (then weekly)
 *   - their payment was confirmed, or not
 *   - the schedule was extended, and why
 *
 * Each message lands in the bell list and, if they turned it on, on their phone.
 */
const CLIENT_URL = "/client";
const ADMIN_URL = "/dashboard/clients";
const inr = (v) => `₹${Math.round(v).toLocaleString("en-IN")}`;
/* ---------------------------------- events ---------------------------------- */
/** The advance was added, or the admin pressed "Ask now". Keyed, so the hourly sweep doesn't say it again. */
export function notifyPaymentRequested(p) {
    notifyLater(clientIds(p.projectId), {
        key: `due:${p.instalmentId}`,
        title: p.isAdvance ? "Advance requested" : "Payment requested",
        body: p.isAdvance
            ? `${p.invoiceNo} · ${inr(p.amount)} is needed to start work on ${p.projectTitle}.`
            : `${p.invoiceNo} · ${p.label}: ${inr(p.amount)} for ${p.projectTitle}. Please pay within 7 days.`,
        url: CLIENT_URL,
    });
}
export function notifyNewInstalment(p) {
    notifyLater(clientIds(p.projectId), {
        title: "Payment schedule updated",
        body: `${p.invoiceNo} · ${p.label} (${inr(p.amount)}) was added for ${p.projectTitle}: ${p.when}.`,
        url: CLIENT_URL,
    });
}
/** A client uploaded a screenshot: every admin hears, so whoever is free can check it */
export function notifyProofSent(p) {
    notifyLater(adminIds(), {
        title: "Payment to check",
        body: `${p.client} sent ${inr(p.amount)} for ${p.projectTitle} · ${p.invoiceNo} ${p.label}. Compare it with the bank statement.`,
        url: ADMIN_URL,
    });
}
export function notifyProofDecided(p) {
    notifyLater(clientIds(p.projectId), {
        title: p.approved ? "Payment received" : "Payment couldn't be confirmed",
        body: p.approved
            ? `Thank you. ${inr(p.amount)} for ${p.invoiceNo} (${p.projectTitle}) is confirmed.`
            : `${inr(p.amount)} for ${p.invoiceNo}: ${p.note || "please check the details"}. You can upload it again.`,
        url: CLIENT_URL,
    });
}
export function notifyDelay(p) {
    notifyLater(clientIds(p.projectId), {
        title: `Schedule extended by ${p.days} ${p.days === 1 ? "day" : "days"}`,
        body: `${p.projectTitle}: ${p.title} (${p.reason}). The new dates are on your project page.`,
        url: CLIENT_URL,
    });
}
/* ---------------------------------- reminders ---------------------------------- */
/**
 * Goes through every ongoing project's payments and sends the reminders that are due. Safe to run as often as
 * you like: each reminder has a key, and nobody gets the same one twice.
 */
export async function sendPaymentReminders(now = new Date()) {
    const projects = await prisma.project.findMany({
        where: { status: "ONGOING", instalments: { some: {} } },
        select: { id: true },
    });
    const admins = await adminIds();
    let sent = 0;
    for (const { id } of projects) {
        const [snap, clients] = await Promise.all([projectSnapshot(prisma, id, now), clientIds(id)]);
        for (const r of paymentReminders(snap.project.title, snap.instalments, now)) {
            sent += (await notify(r.to === "client" ? clients : admins, { key: r.key, title: r.title, body: r.body, url: r.to === "client" ? CLIENT_URL : ADMIN_URL })).length;
        }
    }
    // Screenshots nobody has checked for a day: remind the admins once
    const stale = await prisma.paymentProof.findMany({
        where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - 86_400_000) } },
        select: { id: true, amount: true, project: { select: { title: true } } },
    });
    for (const p of stale) {
        sent += (await notify(admins, { key: `check:${p.id}`, title: "Payment still to check", body: `${inr(p.amount.toNumber())} from the client of ${p.project.title} has been waiting over a day.`, url: ADMIN_URL })).length;
    }
    await purgeOldNotifications();
    return sent;
}
/** Runs the reminders a minute after start, then every hour */
export function startPaymentReminders() {
    const run = () => sendPaymentReminders()
        .then((sent) => sent && logger.info({ sent }, "payment reminders sent"))
        .catch((err) => logger.error({ err }, "payment reminders failed"));
    setTimeout(run, 60_000).unref();
    setInterval(run, 60 * 60 * 1000).unref();
}
//# sourceMappingURL=client.notify.js.map