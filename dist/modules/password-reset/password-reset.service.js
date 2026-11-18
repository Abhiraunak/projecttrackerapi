import crypto from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { startSession } from "../../lib/session.js";
import { mailLayout, sendMail } from "../../lib/mail.js";
import { logger } from "../../config/logger.js";
/*
 * Forgot password, by a 6-digit code sent by email (OWASP Forgot Password Cheat Sheet):
 *   1. forgot  → always the same reply, account or not (nobody learns which emails have accounts)
 *   2. verify  → the right code within 10 minutes and 5 tries gives a one-time reset ticket (15 minutes)
 *   3. reset   → the ticket + a new password: every session is signed out, a "password changed" email is sent,
 *                and the person signs in again (never signed in automatically)
 * Codes and tickets are stored only as hashes. At most 3 codes per account per hour; accounts are never locked.
 */
const CODE_MINUTES = 10;
const TICKET_MINUTES = 15;
const MAX_TRIES = 5;
const MAX_CODES_PER_HOUR = 3;
const RESEND_AFTER_SECONDS = 60;
const minutes = (n) => new Date(Date.now() + n * 60_000);
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const newTicket = () => crypto.randomBytes(32).toString("base64url"); // 43 characters
const WRONG = "That code is wrong or has expired.";
/** Emails are matched whatever their case, as typed at sign-up */
const findUser = (email) => prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, email: true, passwordHash: true } });
/** A hash made for nothing, so an unknown email takes as long as a known one */
let dummyHash = null;
const burnTime = async () => {
    dummyHash ??= argon2.hash("not-a-real-code");
    await argon2.verify(await dummyHash, "000000").catch(() => false);
};
/** POST /auth/password/forgot */
export async function forgot(req, input) {
    const reply = { ok: true, message: "If an account exists for that email, we've sent a 6-digit code. It expires in 10 minutes.", resendAfter: RESEND_AFTER_SECONDS };
    const user = await findUser(input.email);
    if (!user) {
        await burnTime();
        return reply;
    }
    const lastHour = await prisma.passwordReset.findMany({
        where: { userId: user.id, createdAt: { gt: minutes(-60) } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
    });
    // Too many, or too soon after the last one: quietly do nothing (the reply stays the same)
    const tooSoon = lastHour[0] && Date.now() - lastHour[0].createdAt.getTime() < RESEND_AFTER_SECONDS * 1000;
    if (lastHour.length >= MAX_CODES_PER_HOUR || tooSoon) {
        await burnTime();
        return reply;
    }
    const code = newCode();
    const codeHash = await argon2.hash(code);
    await prisma.$transaction([
        // Only the newest code works
        prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
        prisma.passwordReset.create({ data: { userId: user.id, codeHash, expiresAt: minutes(CODE_MINUTES), ip: req.ip ?? null } }),
    ]);
    // Not awaited: the reply takes the same time whether or not the email goes out
    void sendMail({
        to: user.email,
        subject: `${code} is your projecTracker code`,
        text: `Your code to reset your projecTracker password is ${code}. It expires in ${CODE_MINUTES} minutes. If you didn't ask for this, ignore this email; your password stays the same.`,
        html: mailLayout({
            heading: "Reset your password",
            lines: [`Enter this code in projecTracker to set a new password. It expires in ${CODE_MINUTES} minutes.`],
            code,
            footer: "If you didn't ask for this, ignore this email. Your password stays the same, and nobody can change it without this code.",
        }),
    });
    return reply;
}
/** POST /auth/password/verify: the right code gives a one-time ticket for setting the new password */
export async function verify(input) {
    const user = await findUser(input.email);
    const reset = user
        ? await prisma.passwordReset.findFirst({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } })
        : null;
    if (!reset) {
        await burnTime();
        throw new HttpError(400, WRONG);
    }
    // Count the try first, atomically, so parallel guesses can't get past the limit
    const counted = await prisma.passwordReset.updateMany({
        where: { id: reset.id, usedAt: null, attempts: { lt: MAX_TRIES } },
        data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) {
        await prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
        throw new HttpError(429, "Too many wrong tries. Ask for a new code.");
    }
    const ok = await argon2.verify(reset.codeHash, input.code).catch(() => false);
    if (!ok) {
        const left = MAX_TRIES - (reset.attempts + 1);
        if (left <= 0)
            await prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
        throw new HttpError(400, left > 0 ? `${WRONG} ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Ask for a new code.");
    }
    const ticket = newTicket();
    await prisma.passwordReset.update({ where: { id: reset.id }, data: { ticketHash: sha256(ticket), ticketExpiresAt: minutes(TICKET_MINUTES), codeHash: "used" } });
    return { ticket, expiresInMinutes: TICKET_MINUTES };
}
/** POST /auth/password/reset: the ticket + a new password. Signs out every device. */
export async function reset(input) {
    const row = await prisma.passwordReset.findUnique({ where: { ticketHash: sha256(input.ticket) }, include: { user: { select: { id: true, email: true } } } });
    if (!row || row.usedAt || !row.ticketExpiresAt || row.ticketExpiresAt < new Date())
        throw new HttpError(400, "This reset has expired. Ask for a new code.");
    const passwordHash = await argon2.hash(input.password);
    // Claim the ticket and change the password together: a ticket works once, even if sent twice at the same moment
    await prisma.$transaction(async (tx) => {
        const claimed = await tx.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
        if (claimed.count === 0)
            throw new HttpError(400, "This reset has expired. Ask for a new code.");
        await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
        await tx.passwordReset.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
        await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    void tellChanged(row.user.email);
    logger.info({ userId: row.userId }, "Password reset by email code");
    return { ok: true, message: "Password changed. Sign in with your new password." };
}
/** POST /auth/password/change (signed in): the current password + a new one. Other devices are signed out. */
export async function change(req, res, userId, input) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, passwordHash: true } });
    if (!user)
        throw new HttpError(401, "Not signed in");
    const ok = await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false);
    if (!ok)
        throw new HttpError(400, "Your current password is not right.");
    if (await argon2.verify(user.passwordHash, input.newPassword).catch(() => false))
        throw new HttpError(400, "Choose a password different from the current one.");
    const passwordHash = await argon2.hash(input.newPassword);
    await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
        prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
        prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    ]);
    await startSession(req, res, { id: user.id, email: user.email, role: user.role }); // this device stays signed in
    void tellChanged(user.email);
    return { ok: true, message: "Password changed. Other devices have been signed out." };
}
/** Housekeeping: old rows are useless after a day */
export const purgeOldResets = () => prisma.passwordReset.deleteMany({ where: { createdAt: { lt: minutes(-24 * 60) } } });
const tellChanged = (to) => sendMail({
    to,
    subject: "Your projecTracker password was changed",
    text: `The password for your projecTracker account (${to}) was just changed, and every device was signed out. If this wasn't you, reset your password now and tell your admin.`,
    html: mailLayout({
        heading: "Your password was changed",
        lines: [`The password for your projecTracker account was just changed, and every other device was signed out.`],
        footer: "If this wasn't you, use Forgot password on the sign-in page right away, and tell your admin.",
    }),
});
//# sourceMappingURL=password-reset.service.js.map