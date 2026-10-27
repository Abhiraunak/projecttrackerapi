import webpush from "web-push"; // a CommonJS package: use its default export only
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
/**
 * Web push (the standard every modern browser supports). It needs a VAPID key pair in the server settings:
 *   npx web-push generate-vapid-keys
 * Without the keys the app works as before, just without notifications.
 */
export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
if (pushEnabled)
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
else
    logger.warn("Push notifications are off: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to turn them on.");
export const publicKey = () => (pushEnabled ? env.VAPID_PUBLIC_KEY : null);
/** At most this many devices per person: the oldest drops off when a new one is added */
const MAX_DEVICES = 10;
/** Remembers this device for this person. If someone else used it before, it moves to whoever is signed in now. */
export async function saveSubscription(userId, { endpoint, keys }, userAgent) {
    await prisma.$transaction(async (tx) => {
        await tx.pushSubscription.upsert({
            where: { endpoint },
            create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent.slice(0, 300) },
            update: { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent.slice(0, 300) },
        });
        const extra = await tx.pushSubscription.findMany({
            where: { userId },
            orderBy: { updatedAt: "desc" },
            skip: MAX_DEVICES,
            select: { id: true },
        });
        if (extra.length)
            await tx.pushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
    });
}
/** Only the signed-in person's own device can be removed */
export const removeSubscription = (userId, endpoint) => prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
/**
 * Sends a message to every device of these people. Never throws: a notification that can't be delivered must not
 * break what triggered it. Devices the push service says are gone (404 / 410) are forgotten.
 */
export async function sendToUsers(userIds, message) {
    if (!pushEnabled || userIds.length === 0)
        return 0;
    const devices = await prisma.pushSubscription.findMany({ where: { userId: { in: [...new Set(userIds)] } } });
    const payload = JSON.stringify(message);
    const results = await Promise.allSettled(devices.map((device) => webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, {
        TTL: 24 * 60 * 60, // kept for a day if the phone is off
        urgency: "normal",
        timeout: 10_000,
    })));
    const gone = [];
    let sent = 0;
    results.forEach((result, i) => {
        if (result.status === "fulfilled")
            return void sent++;
        const error = result.reason;
        if (error instanceof webpush.WebPushError && (error.statusCode === 404 || error.statusCode === 410))
            gone.push(devices[i].id);
        else
            logger.warn({ err: error, statusCode: error?.statusCode }, "push notification failed");
    });
    if (gone.length)
        await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } }).catch(() => { });
    return sent;
}
//# sourceMappingURL=push.service.js.map