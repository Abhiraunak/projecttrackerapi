import { prisma } from "../../lib/prisma.js";
import { logger } from "../../config/logger.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { sendToUsers } from "../push/push.service.js";

export interface NoticeInput {
  title: string;
  body: string;
  url: string;
  /** A reminder's identity: the same key is sent to a person only once, however often the sweep runs */
  key?: string;
}

/**
 * Saves a notification for each person (the bell list), then pushes it to their phones.
 * With a key, people who already got that notification are skipped. Returns who was actually told.
 */
export async function notify(userIds: string[], notice: NoticeInput): Promise<string[]> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  const told: string[] = [];
  for (const userId of unique) {
    try {
      await prisma.notification.create({ data: { userId, title: notice.title, body: notice.body, url: notice.url, key: notice.key ?? null } });
      told.push(userId);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // already sent this reminder: fine
    }
  }
  if (told.length) {
    await sendToUsers(told, { title: notice.title, body: notice.body, url: notice.url, tag: notice.key ?? undefined });
  }
  return told;
}

/**
 * The same, in the background: a notification that fails must never undo or slow down what triggered it
 * (an approval, an upload). Errors are logged.
 */
export function notifyLater(userIds: string[] | Promise<string[]>, notice: NoticeInput): void {
  void (async () => notify(await userIds, notice))().catch((err) => logger.error({ err, title: notice.title }, "notification failed"));
}

/* ----------------------------------- who ----------------------------------- */

export const adminIds = async () => (await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map((u) => u.id);
export const clientIds = async (projectId: string) =>
  (await prisma.projectClient.findMany({ where: { projectId }, select: { userId: true } })).map((c) => c.userId);

/* ----------------------------------- list ----------------------------------- */

export async function listNotifications(userId: string, limit = 30) {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, title: true, body: true, url: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    unread,
    notifications: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, url: n.url, read: n.readAt !== null, createdAt: n.createdAt.toISOString() })),
  };
}

/** Marks some (or, with no ids, all) of this person's notifications as read. Only their own. */
export async function markRead(userId: string, ids: string[] | undefined) {
  await prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
}

/** Read notifications older than 90 days are cleared away by the reminder sweep */
export const purgeOldNotifications = () =>
  prisma.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
