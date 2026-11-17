import { Resend } from "resend";
import { logger } from "../config/logger.js";

/*
 * Sends email through Resend (https://resend.com). Settings:
 *   RESEND_API_KEY  the API key from the Resend dashboard
 *   MAIL_FROM       e.g. "projecTracker <no-reply@yourdomain.in>": an address on a domain verified in Resend
 * Without a key (development) the email is written to the log instead, so the flow can still be tested.
 */

const key = process.env.RESEND_API_KEY;
const from = process.env.MAIL_FROM ?? "projecTracker <onboarding@resend.dev>";
const resend = key ? new Resend(key) : null;

export interface Mail {
    to: string;
    subject: string;
    html: string;
    text: string;
}

/** Never throws: a failed send is logged, and the caller decides what the person is told */
export async function sendMail(mail: Mail): Promise<boolean> {
    if (!resend) {
        logger.warn({ to: mail.to, subject: mail.subject, text: mail.text }, "RESEND_API_KEY not set: email not sent (shown here instead)");
        return false;
    }
    try {
        const { error } = await resend.emails.send({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text });
        if (error) {
            logger.error({ err: error, to: mail.to }, "Resend refused the email");
            return false;
        }
        return true;
    } catch (err) {
        logger.error({ err, to: mail.to }, "Email could not be sent");
        return false;
    }
}

/** A plain, readable email body: a heading, a few lines, an optional big code */
export function mailLayout(opts: { heading: string; lines: string[]; code?: string; footer: string }) {
    const p = (t: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#333">${t}</p>`;
    const code = opts.code
        ? `<p style="margin:20px 0;font-size:32px;font-weight:700;letter-spacing:8px;color:#111;font-family:ui-monospace,Menlo,monospace">${opts.code}</p>`
        : "";
    return `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e8e8e6;border-radius:16px;padding:28px">
<p style="margin:0 0 20px;font-size:14px;font-weight:600;color:#111">projecTracker</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#111">${opts.heading}</h1>
${opts.lines.map(p).join("")}${code}
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8c8c8c">${opts.footer}</p>
</div></body></html>`;
}