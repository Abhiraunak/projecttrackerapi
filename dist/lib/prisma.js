import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
// adjust the relative path to where this file lives (here: src/lib/prisma.ts)
const globalForPrisma = globalThis;
function createClient() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    return new PrismaClient({ adapter });
}
export const prisma = globalForPrisma.__prisma ?? createClient();
if (process.env.NODE_ENV !== "production")
    globalForPrisma.__prisma = prisma;
//# sourceMappingURL=prisma.js.map