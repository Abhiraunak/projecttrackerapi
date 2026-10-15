import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
const searchSchema = z.object({ q: z.string().trim().max(100).optional() });
/** People you can share with: everyone except yourself, filtered by email, at most 20 */
export async function search(req, res) {
    const { q } = searchSchema.parse(req.query);
    const users = await prisma.user.findMany({
        where: { id: { not: req.user.sub }, ...(q ? { email: { contains: q, mode: "insensitive" } } : {}) },
        select: { id: true, email: true }, // never anything else (no password hash, no role)
        orderBy: { email: "asc" },
        take: 20,
    });
    res.json({ users });
}
//# sourceMappingURL=users.controller.js.map