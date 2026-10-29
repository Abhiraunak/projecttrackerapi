import type { Request, Response } from "express";
import { z } from "zod";
import { adminOverview } from "./dashboard.service.js";

const querySchema = z.object({ period: z.enum(["week", "month", "quarter"]).default("week") });

/** GET /dashboard/overview?period=week|month|quarter (admins only) */
export async function overview(req: Request, res: Response) {
  const { period } = querySchema.parse(req.query); // req.query is read-only in Express 5, so it is parsed here
  res.json(await adminOverview(req.user!.sub, period));
}
