import { Prisma } from "../generated/prisma/client.js";
/** True when a unique constraint was broken (for example the same name twice) */
export const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
//# sourceMappingURL=prismaErrors.js.map