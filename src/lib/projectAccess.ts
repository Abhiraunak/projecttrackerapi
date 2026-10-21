import { prisma } from "./prisma.js";

import { effectivePermissions, type Permission } from "./permissions.js";
import { HttpError } from "./error.js";

export interface UserAccess {
  isAdmin: boolean;
  permissions: Permission[];
}

export interface ProjectAccess extends UserAccess {
  project: { id: string; ownerId: string };
}

/**
 * Read fresh from the database on every request (not from the sign-in token),
 * so when an admin changes someone's access it applies at once, not when their token expires.
 */
export async function getUserAccess(userId: string): Promise<UserAccess> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, permissions: true } });
  if (!user) throw new HttpError(401, "Account not found");
  return { isAdmin: user.role === "ADMIN", permissions: effectivePermissions(user) };
}

export async function requireCan(userId: string, permission: Permission): Promise<UserAccess> {
  const access = await getUserAccess(userId);
  if (!access.permissions.includes(permission)) throw new HttpError(403, "You don't have permission to do that. Ask an admin.");
  return access;
}

export async function requireAdmin(userId: string): Promise<UserAccess> {
  const access = await getUserAccess(userId);
  if (!access.isAdmin) throw new HttpError(403, "Only an admin can do that.");
  return access;
}

/** The permission (company-wide), and a project that exists */
export async function requirePermission(userId: string, projectId: string, permission: Permission): Promise<ProjectAccess> {
  const access = await requireCan(userId, permission);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true } });
  if (!project) throw new HttpError(404, "Project not found");
  return { ...access, project };
}

/** @deprecated kept so older imports still compile. It now means "may manage projects". */
export const assertProjectOwner = async (userId: string, projectId: string): Promise<void> => {
  await requirePermission(userId, projectId, "project.manage");
};
