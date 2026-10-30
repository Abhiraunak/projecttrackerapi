import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { listNotifications, markRead } from "./notifications.service.js";

const readSchema = z.object({ body: z.object({ ids: z.array(z.string().min(1).max(64)).max(100).optional() }) });

// Mounted at /api/v1/notifications. Everyone signed in, staff and clients: each person only ever sees their own.
const router = Router();
router.use(requireAuth);

router.get("/", async (req: Request, res: Response) => {
  res.json(await listNotifications(req.user!.sub));
});

router.post("/read", validate(readSchema), async (req: Request<unknown, unknown, { ids?: string[] }>, res: Response) => {
  await markRead(req.user!.sub, req.body.ids);
  res.status(204).end();
});

export default router;
