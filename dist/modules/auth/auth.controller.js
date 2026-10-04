import argon2 from "argon2";
import { prisma } from "../../lib/prisma.js";
import { endAllSessions, endSession, refreshSession, startSession } from "../../lib/session.js";
const publicUser = (u) => ({ id: u.id, email: u.email, role: u.role });
export async function register(req, res) {
    const { email, password } = req.body;
    const passwordHash = await argon2.hash(password);
    const user = await prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true, role: true }, // never return the hash
    });
    res.status(201).json({ user });
}
export async function login(req, res) {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = user && (await argon2.verify(user.passwordHash, password));
    if (!user || !ok) {
        res.status(401).json({ error: "Invalid credentials" }); // same message for both cases
        return;
    }
    await startSession(req, res, user);
    res.json({ user: publicUser(user) });
}
/** Silent renewal: the browser calls this when the access token has expired */
export async function refresh(req, res) {
    const user = await refreshSession(req, res);
    res.json({ user: publicUser(user) });
}
export async function logout(req, res) {
    await endSession(req, res);
    res.status(204).end();
}
export async function logoutAll(req, res) {
    await endAllSessions(req.user.sub, res);
    res.status(204).end();
}
export async function me(req, res) {
    const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { id: true, email: true, role: true },
    });
    res.json({ user });
}
//# sourceMappingURL=auth.controller.js.map