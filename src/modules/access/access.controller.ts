import type { Request, Response } from "express";
import { getUserAccess } from "../../lib/projectAccess.js";

/** What the signed-in person may do. The browser uses it to choose the menu, the pages and the buttons. */
export async function me(req: Request, res: Response) {
  res.json(await getUserAccess(req.user!.sub));
}
