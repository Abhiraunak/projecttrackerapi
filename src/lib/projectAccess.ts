import { HttpError } from "./error.js";
import { prisma } from "./prisma.js";

/**
 * The project must exist and belong to this user.
 * It answers 404 rather than 403, so nobody can learn which project ids exist.
 * (When project roles are added, this is the one place to check membership instead of ownership.)
 */
export async function assertProjectOwner(ownerId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId }, select: { id: true } });
  if (!project) throw new HttpError(404, "Project not found");
}
