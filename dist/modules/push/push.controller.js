import { publicKey, pushEnabled, removeSubscription, saveSubscription, sendToUsers } from "./push.service.js";
const uid = (req) => req.user.sub;
/** The browser needs this key to turn notifications on */
export function config(_req, res) {
    res.json({ enabled: pushEnabled, publicKey: publicKey() });
}
export async function subscribe(req, res) {
    await saveSubscription(uid(req), req.body, req.get("user-agent") ?? "");
    res.status(204).end();
}
export async function unsubscribe(req, res) {
    await removeSubscription(uid(req), req.body.endpoint);
    res.status(204).end();
}
/** "Send a test": lets someone check notifications reach their devices */
export async function test(req, res) {
    const sent = await sendToUsers([uid(req)], {
        title: "Notifications are on",
        body: "You'll be told here when someone shares a drawing with you.",
        url: "/dashboard/drawing",
        tag: "test",
    });
    res.json({ sent });
}
//# sourceMappingURL=push.controller.js.map