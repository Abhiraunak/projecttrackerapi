import { Prisma } from "../generated/prisma/client.js";


/** True when a unique constraint was broken (for example the same name twice) */
export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
