import { prisma } from "./prisma.js";
import { logger } from "../config/logger.js";
const MAX_STREAMS_PER_USER = 6; // a few tabs and phones; more is a leak
const HEARTBEAT_MS = 25_000; // proxies close idle connections after ~60 s
const streams = new Map();
function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.flush?.(); // if compression is on, push it out now
}
/** GET /notifications/stream: keeps the connection open and sends "changed" messages down it */
export function openStream(req, res) {
    const userId = req.user.sub;
    res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        // no-transform: the compression middleware leaves it alone (a compressed stream would be held back)
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // nginx-style proxies: don't buffer
    });
    res.write("retry: 5000\n\n"); // the browser reconnects after 5 s if the connection drops
    const mine = streams.get(userId) ?? new Set();
    if (mine.size >= MAX_STREAMS_PER_USER) {
        const oldest = mine.values().next().value;
        oldest?.end();
        if (oldest)
            mine.delete(oldest);
    }
    mine.add(res);
    streams.set(userId, mine);
    send(res, "ready", { at: Date.now() });
    const beat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
    beat.unref();
    req.on("close", () => {
        clearInterval(beat);
        mine.delete(res);
        if (mine.size === 0)
            streams.delete(userId);
    });
}
/** Tell these people that these things changed */
export function publish(userIds, topics) {
    for (const id of new Set(userIds)) {
        for (const res of streams.get(id) ?? [])
            send(res, "changed", { topics });
    }
}
/* --------------------------------- per project -------------------------------- */
// Several edits in a row (dragging a progress slider, recording a few payments) send one message, not many
const pending = new Map();
const DEBOUNCE_MS = 800;
/** A project's client-visible data changed: its clients' portals and every admin's client page reload it */
export function announceProject(projectId) {
    clearTimeout(pending.get(projectId));
    pending.set(projectId, setTimeout(() => {
        pending.delete(projectId);
        void (async () => {
            const [clients, admins] = await Promise.all([
                prisma.projectClient.findMany({ where: { projectId }, select: { userId: true } }),
                prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } }),
            ]);
            publish(clients.map((c) => c.userId), ["client"]);
            publish(admins.map((a) => a.id), ["client-admin"]);
        })().catch((err) => logger.error({ err, projectId }, "live update failed"));
    }, DEBOUNCE_MS));
}
/**
 * Route middleware: after a successful change (not a GET), announce the project it touched.
 * `projectOf` finds the project from the request; it runs after the response, so it never slows the request down.
 */
export const announceAfter = (projectOf) => (req, res, next) => {
    if (req.method !== "GET") {
        res.on("finish", () => {
            if (res.statusCode >= 400)
                return;
            void Promise.resolve(projectOf(req))
                .then((projectId) => projectId && announceProject(projectId))
                .catch((err) => logger.error({ err }, "live update lookup failed"));
        });
    }
    next();
};
//# sourceMappingURL=live.js.map