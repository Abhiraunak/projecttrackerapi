import { prisma } from "./prisma.js";
import { PERMISSIONS, effectivePermissions } from "./permissions.js";
import { HttpError } from "./error.js";
/**
 * DEVELOPMENT ONLY: DEV_FULL_ACCESS=true in .env makes every signed-in account an admin, without reading the
 * access columns at all (so it works before the access migration is run). It is ignored when NODE_ENV is
 * "production", so it can't open up the live site even if the setting is copied there by mistake.
 */
const DEV_FULL_ACCESS = process.env.DEV_FULL_ACCESS === "true" && process.env.NODE_ENV !== "production";
if (DEV_FULL_ACCESS)
    console.warn("[access] DEV_FULL_ACCESS is on: every signed-in account has full access. Development only.");
/**
 * Read fresh from the database on every request (not from the sign-in token),
 * so when an admin changes someone's access it applies at once, not when their token expires.
 */
export async function getUserAccess(userId) {
    if (DEV_FULL_ACCESS)
        return { isAdmin: true, permissions: [...PERMISSIONS] };
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, permissions: true } });
    if (!user)
        throw new HttpError(401, "Account not found");
    return { isAdmin: user.role === "ADMIN", permissions: effectivePermissions(user) };
}
export async function requireCan(userId, permission) {
    const access = await getUserAccess(userId);
    if (!access.permissions.includes(permission))
        throw new HttpError(403, "You don't have permission to do that. Ask an admin.");
    return access;
}
export async function requireAdmin(userId) {
    const access = await getUserAccess(userId);
    if (!access.isAdmin)
        throw new HttpError(403, "Only an admin can do that.");
    return access;
}
/** The permission (company-wide), and a project that exists */
export async function requirePermission(userId, projectId, permission) {
    const access = await requireCan(userId, permission);
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true } });
    if (!project)
        throw new HttpError(404, "Project not found");
    return { ...access, project };
}
/** @deprecated kept so older imports still compile. It now means "may manage projects". */
export const assertProjectOwner = async (userId, projectId) => {
    await requirePermission(userId, projectId, "project.manage");
};
//# sourceMappingURL=projectAccess.js.map