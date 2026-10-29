import argon2 from "argon2";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
/**
 * Makes sure the admin account named in the server settings (ADMIN_EMAIL + ADMIN_PASSWORD) exists.
 * Runs once when the server starts, before it accepts any request.
 *
 *  - No account with that email yet: it is created as an admin, with that password.
 *  - It exists and is already an admin: nothing happens. The password is never overwritten on a restart.
 *  - Someone already signed up with that email as a normal user: they are made admin ONLY if their password
 *    matches ADMIN_PASSWORD. Otherwise a stranger who registered the email first could become admin.
 */
export async function ensureAdminAccount() {
    const email = env.ADMIN_EMAIL;
    const password = env.ADMIN_PASSWORD;
    if (!email || !password) {
        const admins = await prisma.user.count({ where: { role: "ADMIN" } });
        if (admins === 0)
            logger.warn("No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart.");
        return;
    }
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, passwordHash: true } });
    if (!existing) {
        await prisma.user.create({ data: { email, passwordHash: await argon2.hash(password), role: "ADMIN" } });
        logger.info({ email }, "Admin account created from ADMIN_EMAIL");
        return;
    }
    if (existing.role === "ADMIN")
        return;
    if (await argon2.verify(existing.passwordHash, password)) {
        await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
        logger.info({ email }, "Existing account made admin (its password matches ADMIN_PASSWORD)");
    }
    else {
        logger.warn({ email }, "An account with ADMIN_EMAIL already exists with a different password, so it was NOT made admin. " +
            "Use a different ADMIN_EMAIL, or run src/scripts/makeAdmin.ts if that account really is yours.");
    }
}
//# sourceMappingURL=adminBootstrap.js.map