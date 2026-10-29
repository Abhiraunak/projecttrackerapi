/**
 * Makes an existing account an admin. Only needed once, to set up an existing database.
 * (On a fresh database the first person to sign up becomes admin automatically.)
 *
 *   npx tsx --env-file=.env src/scripts/makeAdmin.ts you@example.com
 */

import { prisma } from "../lib/prisma.js";


const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npx tsx --env-file=.env src/scripts/makeAdmin.ts you@example.com");
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
if (!user) {
  console.error(`No account uses ${email}. Sign up with it first.`);
  await prisma.$disconnect();
  process.exit(1);
}

await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
console.log(`${email} is now an admin.`);
await prisma.$disconnect();
