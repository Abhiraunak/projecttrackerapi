/**
 * Create an admin account, or make an existing account an admin, straight in the database. For production, where
 * nobody can sign up as admin from the app.
 *
 *   npx tsx --env-file=.env.production src/scripts/createAdmin.ts --email you@firm.com --name "Your Name"
 *
 *  - No account with that email: creates it as an admin. The password is asked for on the screen (hidden, at least
 *    8 characters, typed twice). It never goes into the command, so it isn't kept in the terminal history.
 *  - The account exists: makes it an admin and keeps its password. Add --reset-password to set a new one as well.
 *  - Signing out everywhere: when the password is reset, every device that was signed in is signed out.
 *
 * For a script or CI, the password can come from the environment instead of the prompt:
 *   NEW_ADMIN_PASSWORD='…' npx tsx --env-file=.env.production src/scripts/createAdmin.ts --email you@firm.com
 *
 * Safe to run again: running it for an admin that already exists changes nothing (unless --reset-password).
 */
import argon2 from "argon2";
import readline from "node:readline";
import { prisma } from "../lib/prisma.js";
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1]?.trim() : undefined;
};
const email = value("email")?.toLowerCase();
const name = value("name") || null;
const resetPassword = flag("reset-password");
const fail = async (message) => {
    console.error(message);
    await prisma.$disconnect();
    process.exit(1);
};
/** Ask for a password without showing what is typed */
function askHidden(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const write = rl._writeToOutput.bind(rl);
        let asked = false;
        rl._writeToOutput = (s) => {
            if (!asked)
                return write(s); // the question itself
            if (s.includes("\n"))
                write("\n");
        };
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
        asked = true;
    });
}
async function newPassword() {
    const fromEnv = process.env.NEW_ADMIN_PASSWORD;
    const password = fromEnv ?? (await askHidden("New password (at least 8 characters): "));
    if (password.length < 8)
        return fail("The password needs at least 8 characters. Nothing was changed.");
    if (password.length > 128)
        return fail("The password can be at most 128 characters. Nothing was changed.");
    if (!fromEnv && (await askHidden("Type it again: ")) !== password)
        return fail("The two passwords don't match. Nothing was changed.");
    return password;
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await fail('Usage: npx tsx --env-file=.env.production src/scripts/createAdmin.ts --email you@firm.com [--name "Your Name"] [--reset-password]');
}
// Which database: shown so nobody creates an admin on the wrong one by mistake
const host = (() => {
    try {
        return new URL(process.env.DATABASE_URL ?? "").host || "(unknown)";
    }
    catch {
        return "(unknown)";
    }
})();
console.log(`Database: ${host}`);
const existing = await prisma.user.findUnique({ where: { email: email }, select: { id: true, role: true, name: true } });
if (!existing) {
    const password = await newPassword();
    await prisma.user.create({ data: { email: email, name, passwordHash: await argon2.hash(password), role: "ADMIN" } });
    console.log(`Created ${email} as an admin. Sign in with this email and the password you typed.`);
}
else {
    if (existing.role === "CLIENT")
        await fail(`${email} is a client account. Use a different email for the admin.`);
    const data = { role: "ADMIN" };
    if (name && !existing.name)
        data.name = name;
    if (resetPassword)
        data.passwordHash = await argon2.hash(await newPassword());
    if (existing.role === "ADMIN" && !data.passwordHash && !data.name) {
        console.log(`${email} is already an admin. Nothing to change (add --reset-password to set a new password).`);
    }
    else {
        await prisma.$transaction(async (tx) => {
            await tx.user.update({ where: { id: existing.id }, data });
            // A new password signs every device out, so an old session can't carry on
            if (data.passwordHash)
                await tx.refreshToken.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
        });
        console.log(`${email} is ${existing.role === "ADMIN" ? "still" : "now"} an admin.` +
            (data.passwordHash ? " The password was changed and every device was signed out." : " Their password is unchanged."));
    }
}
await prisma.$disconnect();
//# sourceMappingURL=makeAdmin.js.map