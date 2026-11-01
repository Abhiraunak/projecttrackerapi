import type { Request, RequestHandler, Response } from "express";
import { prisma } from "./prisma.js";
import { logger } from "../config/logger.js";

/*
 * Live updates. Each open app keeps one connection to GET /notifications/stream (Server-Sent Events). When
 * something changes, the server sends a short "this changed" message to the people concerned, and their app
 * reloads just that data, so no one has to refresh the page.
 *
 * Messages say what changed, never the data itself; the app fetches the data through the normal, permission-checked
 * calls. So a message reaching the wrong person would reveal nothing.
 *
 * One server instance holds its own connections. That is what Render's web service runs by default. If you scale
 * the API to several instances, connect them with Postgres LISTEN/NOTIFY or Redis pub/sub (see LIVE-UPDATES.md).
 */

/** What changed. The app maps each topic to the data it reloads. */
export type Topic = "notifications" | "client" | "client-admin";

const MAX_STREAMS_PER_USER = 6; // a few tabs and phones; more is a leak
const HEARTBEAT_MS = 25_000; // proxies close idle connections after ~60 s

const streams = new Map<string, Set<Response>>();

function send(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  (res as Response & { flush?: () => void }).flush?.(); // if compression is on, push it out now
}

/** GET /notifications/stream: keeps the connection open and sends "changed" messages down it */
export function openStream(req: Request, res: Response) {
  const userId = req.user!.sub;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    // no-transform: the compression middleware leaves it alone (a compressed stream would be held back)
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // nginx-style proxies: don't buffer
  });
  res.write("retry: 5000\n\n"); // the browser reconnects after 5 s if the connection drops

  const mine = streams.get(userId) ?? new Set<Response>();
  if (mine.size >= MAX_STREAMS_PER_USER) {
    const oldest = mine.values().next().value as Response | undefined;
    oldest?.end();
    if (oldest) mine.delete(oldest);
  }
  mine.add(res);
  streams.set(userId, mine);
  send(res, "ready", { at: Date.now() });

  const beat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
  beat.unref();
  req.on("close", () => {
    clearInterval(beat);
    mine.delete(res);
    if (mine.size === 0) streams.delete(userId);
  });
}

/** Tell these people that these things changed */
export function publish(userIds: string[], topics: Topic[]) {
  for (const id of new Set(userIds)) {
    for (const res of streams.get(id) ?? []) send(res, "changed", { topics });
  }
}

/* --------------------------------- per project -------------------------------- */

// Several edits in a row (dragging a progress slider, recording a few payments) send one message, not many
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 800;

/** A project's client-visible data changed: its clients' portals and every admin's client page reload it */
export function announceProject(projectId: string) {
  clearTimeout(pending.get(projectId));
  pending.set(
    projectId,
    setTimeout(() => {
      pending.delete(projectId);
      void (async () => {
        const [clients, admins] = await Promise.all([
          prisma.projectClient.findMany({ where: { projectId }, select: { userId: true } }),
          prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } }),
        ]);
        publish(clients.map((c) => c.userId), ["client"]);
        publish(admins.map((a) => a.id), ["client-admin"]);
      })().catch((err: unknown) => logger.error({ err, projectId }, "live update failed"));
    }, DEBOUNCE_MS)
  );
}

/**
 * Route middleware: after a successful change (not a GET), announce the project it touched.
 * `projectOf` finds the project from the request; it runs after the response, so it never slows the request down.
 */
export const announceAfter =
  (projectOf: (req: Request) => Promise<string | null | undefined> | string | null | undefined): RequestHandler =>
  (req, res, next) => {
    if (req.method !== "GET") {
      res.on("finish", () => {
        if (res.statusCode >= 400) return;
        void Promise.resolve(projectOf(req))
          .then((projectId) => projectId && announceProject(projectId))
          .catch((err: unknown) => logger.error({ err }, "live update lookup failed"));
      });
    }
    next();
  };
