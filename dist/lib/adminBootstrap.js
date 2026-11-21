import argon2 from "argon2";
import { prisma } from "./prisma.js";
/**
 * Makes sure the admin account named in the server settings exists. Runs once when the server starts.
 *
 *   ADMIN_EMAIL=you@yourfirm.com
 *   ADMIN_PASSWORD=a-strong-password      (at least 8 characters; remove it once you have signed in)
 *   ADMIN_NAME=Your Name                  (optional)
 *
 *  - No account with that email: it is created as an admin with that password.
 *  - It exists and is already an admin: nothing happens. The password is never overwritten on a restart.
 *  - Someone already signed up with that email as a normal user: they are made admin ONLY if their password matches
 *    ADMIN_PASSWORD. Otherwise a stranger who registered the email first could become admin.
 *  - Settings missing: nothing is created; a warning is printed while there is no admin at all.
 *
 * It never stops the server: a problem here is printed, and the app still starts.
 */
export async function ensureAdminAccount() {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD ?? "";
    const name = process.env.ADMIN_NAME?.trim() || null;
    try {
        if (!email || !password) {
            const admins = await prisma.user.count({ where: { role: "ADMIN" } });
            if (admins === 0)
                console.warn("[admin] No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart.");
            return;
        }
        if (password.length < 8) {
            console.warn("[admin] ADMIN_PASSWORD needs at least 8 characters. No admin was created.");
            return;
        }
        const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, passwordHash: true } });
        if (!existing) {
            await prisma.user.create({ data: { email, name, passwordHash: await argon2.hash(password), role: "ADMIN" } });
            console.info(`[admin] Admin account created for ${email}. Sign in, then remove ADMIN_PASSWORD from the settings.`);
            return;
        }
        if (existing.role === "ADMIN")
            return;
        if (existing.role !== "CLIENT" && (await argon2.verify(existing.passwordHash, password))) {
            await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
            console.info(`[admin] ${email} already had an account; it is now an admin (its password matches ADMIN_PASSWORD).`);
        }
        else {
            console.warn(`[admin] ${email} already has an account with a different password (or is a client), so it was NOT made admin. ` +
                "Use another ADMIN_EMAIL, or run src/scripts/createAdmin.ts if that account really is yours.");
        }
    }
    catch (err) {
        console.error("[admin] Couldn't check the admin account:", err);
    }
}
//# sourceMappingURL=adminBootstrap.js.map