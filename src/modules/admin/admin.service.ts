import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { PERMISSIONS, isPermission } from "../../lib/permissions.js";
import { diffFields } from "../audit/audit.diff.js";
import { recordAudit } from "../audit/audit.service.js";
import type { UpdateAccessBody } from "./admin.schema.js";

const USER_COLUMNS = { id: true, email: true, role: true, permissions: true, createdAt: true } as const;

type UserRow = { id: string; email: string; role: "USER" | "ADMIN"; permissions: string[]; createdAt: Date };

const userDto = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  isAdmin: u.role === "ADMIN",
  permissions: u.permissions.filter(isPermission),
  createdAt: u.createdAt,
});

/** In the fixed order of the permission list, without repeats, so the log reads the same way each time */
const tidy = (permissions: string[]) => PERMISSIONS.filter((p) => permissions.includes(p));

/** Everyone with an account, oldest first */
export async function listUsers() {
  const users = await prisma.user.findMany({ select: USER_COLUMNS, orderBy: { createdAt: "asc" } });
  return users.map(userDto);
}

/**
 * Sets whether someone is an admin and which permissions they have.
 * There must always be at least one admin, or nobody could hand out access any more.
 */
export async function updateAccess(actorId: string, userId: string, { isAdmin, permissions }: UpdateAccessBody) {
  return prisma.$transaction(async (tx) => {
    // One change to admins at a time: two admins removing each other at the same moment must not leave none
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('company-admins'))`;

    const target = await tx.user.findUnique({ where: { id: userId }, select: USER_COLUMNS });
    if (!target) throw new HttpError(404, "User not found");

    if (target.role === "ADMIN" && !isAdmin) {
      const admins = await tx.user.count({ where: { role: "ADMIN" } });
      if (admins <= 1) throw new HttpError(409, "There must always be at least one admin. Make someone else an admin first.");
    }

    const granted = tidy(permissions);
    const updated = await tx.user.update({
      where: { id: userId },
      data: { role: isAdmin ? "ADMIN" : "USER", permissions: granted },
      select: USER_COLUMNS,
    });

    await recordAudit(tx, {
      projectId: null, // company-wide, not about one project
      actorId,
      action: "user.access_changed",
      entityType: "user",
      entityId: userId,
      summary: `Changed access for ${target.email}`,
      changes: diffFields(
        { admin: target.role === "ADMIN", permissions: tidy(target.permissions).join(", ") },
        { admin: isAdmin, permissions: granted.join(", ") },
        ["admin", "permissions"]
      ),
    });
    return userDto(updated);
  });
}
