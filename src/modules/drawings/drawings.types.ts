import { Prisma } from "../../generated/prisma/client.js";


/** What to load with a drawing: who owns it and who it is shared with */
export const drawingInclude = {
  owner: { select: { id: true, email: true } },
  shares: { include: { user: { select: { id: true, email: true } } } },
} as const;

export type DrawingRow = Prisma.DrawingGetPayload<{ include: typeof drawingInclude }>;
