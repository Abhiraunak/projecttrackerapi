import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env, isProd } from "../config/env.js";
import { HttpError } from "./error.js";
import { prisma } from "./prisma.js";
/**
 * Sessions = a short-lived access token (JWT cookie) + a long-lived refresh token (random string, stored hashed).
 *
 * - The access token is checked on every request without touching the database.
 * - When it expires, the browser calls POST /auth/refresh. The refresh token is exchanged for a NEW pair and the old
 *   one is marked used (rotation).
 * - If an already-used refresh token shows up again (after a short grace period), someone copied it, so the whole
 *   login (family) is revoked.
 */
const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";
const REFRESH_PATH = "/api/v1/auth"; // the refresh cookie is only sent to auth routes, never to normal API calls
const REUSE_GRACE_MS = 10_000; // two tabs refreshing at the same moment is normal, not an attack
const DAY_MS = 86_400_000;
const sameSite = env.COOKIE_SAMESITE;
const secure = isProd || sameSite === "none"; // browsers reject SameSite=None without Secure
const accessCookie = {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: env.ACCESS_TOKEN_TTL_MINUTES * 60_000,
};
const refreshCookie = {
    httpOnly: true,
    secure,
    sameSite,
    path: REFRESH_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
};
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const newRawToken = () => crypto.randomBytes(48).toString("base64url");
const signAccess = (user) => jwt.sign({ sub: user.id, role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
});
function setCookies(res, access, refreshRaw) {
    res.cookie(ACCESS_COOKIE, access, accessCookie);
    res.cookie(REFRESH_COOKIE, refreshRaw, refreshCookie);
}
export function clearCookies(res) {
    res.clearCookie(ACCESS_COOKIE, accessCookie);
    res.clearCookie(REFRESH_COOKIE, refreshCookie); // must use the same path it was set with
}
async function issueRefresh(userId, familyId, authTime, req) {
    const raw = newRawToken();
    await prisma.refreshToken.create({
        data: {
            userId,
            familyId,
            authTime,
            tokenHash: sha256(raw),
            expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
            userAgent: req.get("user-agent")?.slice(0, 200),
            ip: req.ip,
        },
    });
    return raw;
}
const revokeFamily = (familyId) => prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
/** A failed refresh also clears the cookies, so the browser stops sending dead tokens */
const reject = (res, message = "Session expired") => {
    clearCookies(res);
    return new HttpError(401, message);
};
/** Called after a correct password: starts a brand-new session (new family) */
export async function startSession(req, res, user) {
    const refresh = await issueRefresh(user.id, crypto.randomUUID(), new Date(), req);
    setCookies(res, signAccess(user), refresh);
}
/** Exchanges the refresh cookie for a fresh access + refresh token. Returns the current user. */
export async function refreshSession(req, res) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw)
        throw reject(res, "Not signed in");
    const current = await prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(raw) },
        include: { user: { select: { id: true, email: true, role: true } } }, // fresh from the DB, so role changes apply
    });
    if (!current || current.revokedAt || current.expiresAt <= new Date())
        throw reject(res);
    // Hard cap: even an always-active user must sign in again after SESSION_MAX_DAYS
    if (Date.now() - current.authTime.getTime() > env.SESSION_MAX_DAYS * DAY_MS) {
        await revokeFamily(current.familyId);
        throw reject(res);
    }
    const now = new Date();
    if (current.usedAt && now.getTime() - current.usedAt.getTime() > REUSE_GRACE_MS) {
        // An old token came back well after it was exchanged: treat as stolen and end this whole login
        await revokeFamily(current.familyId);
        throw reject(res);
    }
    if (!current.usedAt) {
        // Atomic claim. If a parallel request won, count is 0, but it set usedAt a moment ago, which is inside the grace period.
        await prisma.refreshToken.updateMany({ where: { id: current.id, usedAt: null }, data: { usedAt: now } });
    }
    const refresh = await issueRefresh(current.userId, current.familyId, current.authTime, req);
    setCookies(res, signAccess(current.user), refresh);
    return current.user;
}
/** Sign out this device: revokes the whole login family for the presented refresh token */
export async function endSession(req, res) {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) {
        const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) }, select: { familyId: true } });
        if (record)
            await revokeFamily(record.familyId);
    }
    clearCookies(res);
}
/** "Sign out everywhere": revokes every login of this user */
export async function endAllSessions(userId, res) {
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    clearCookies(res);
}
/** Housekeeping: expired tokens can never be used again, so they are just clutter */
export const purgeExpiredSessions = () => prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
//# sourceMappingURL=session.js.map