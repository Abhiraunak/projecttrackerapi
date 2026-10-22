import type { Request, Response } from "express";
import { publicKey, pushEnabled, removeSubscription, saveSubscription, sendToUsers } from "./push.service.js";
import type { SubscribeBody } from "./push.schema.js";

const uid = (req: Request<any, any, any, any>) => req.user!.sub;

/** The browser needs this key to turn notifications on */
export function config(_req: Request, res: Response) {
  res.json({ enabled: pushEnabled, publicKey: publicKey() });
}

export async function subscribe(req: Request<unknown, unknown, SubscribeBody>, res: Response) {
  await saveSubscription(uid(req), req.body, req.get("user-agent") ?? "");
  res.status(204).end();
}

export async function unsubscribe(req: Request<unknown, unknown, { endpoint: string }>, res: Response) {
  await removeSubscription(uid(req), req.body.endpoint);
  res.status(204).end();
}

/** "Send a test": lets someone check notifications reach their devices */
export async function test(req: Request, res: Response) {
  const sent = await sendToUsers([uid(req)], {
    title: "Notifications are on",
    body: "You'll be told here when someone shares a drawing with you.",
    url: "/dashboard/drawing",
    tag: "test",
  });
  res.json({ sent });
}
