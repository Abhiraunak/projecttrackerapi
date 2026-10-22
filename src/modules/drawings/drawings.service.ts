import { prisma } from "../../lib/prisma.js";
import { deleteDrawingFile, uploadDrawingFile } from "../../lib/cloudinary.js";
import { ACCEPTED_DESCRIPTION, detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { notifyDrawingShared } from "../push/push.notify.js";
import { kindOf, toDrawingDto } from "./drawings.mapper.js";
import { drawingInclude } from "./drawings.types.js";
import type { ListQuery } from "./drawings.schema.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../lib/error.js";

/* ------------------------------ small helpers ----------------------------- */

/** Which drawings this person may see for the chosen tab */
function scopeFilter(scope: ListQuery["scope"], viewerId: string): Prisma.DrawingWhereInput {
  const mine: Prisma.DrawingWhereInput = { ownerId: viewerId };
  const shared: Prisma.DrawingWhereInput = { shares: { some: { userId: viewerId } } };
  if (scope === "mine") return mine;
  if (scope === "shared") return shared;
  return { OR: [mine, shared] };
}

function searchFilter(q: string | undefined): Prisma.DrawingWhereInput {
  if (!q) return {};
  return {
    OR: [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ],
  };
}

/** Removes duplicates and the owner, and makes sure every chosen person really exists */
async function resolveRecipients(ownerId: string, requested: string[]): Promise<string[]> {
  const ids = [...new Set(requested)].filter((id) => id !== ownerId);
  if (ids.length === 0) return [];

  const found = await prisma.user.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new HttpError(400, "One or more people you chose could not be found.");
  return ids;
}

const shareRows = (userIds: string[]) => userIds.map((userId) => ({ userId }));

const KIND = { image: "IMAGE", pdf: "PDF", cad: "CAD" } as const;

/* ------------------------------- operations ------------------------------- */

export async function listDrawings(viewerId: string, { scope, q, page, pageSize }: ListQuery) {
  const where: Prisma.DrawingWhereInput = { AND: [scopeFilter(scope, viewerId), searchFilter(q)] };

  const [rows, total] = await prisma.$transaction([
    prisma.drawing.findMany({
      where,
      include: drawingInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], // id breaks ties so pages never repeat or skip a row
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.drawing.count({ where }),
  ]);

  return {
    items: rows.map((row) => toDrawingDto(row, viewerId)),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

interface CreateInput {
  ownerId: string;
  title: string;
  description: string;
  sharedWith: string[];
  file: Express.Multer.File;
}

export async function createDrawing({ ownerId, title, description, sharedWith, file }: CreateInput) {
  // 1. Cheap checks first, so a bad request never costs an upload
  const detected = detectFileType(file.buffer);
  if (!detected) throw new HttpError(415, `Only ${ACCEPTED_DESCRIPTION} files are allowed.`);
  if (detected.kind === "image" && file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Images can be up to 10 MB.");
  const recipients = await resolveRecipients(ownerId, sharedWith);

  // 2. The file goes to Cloudinary
  const stored = await uploadDrawingFile(file.buffer, detected);

  // 3. Only the reference is saved. If saving fails, don't leave an orphan file behind.
  let row;
  try {
    row = await prisma.drawing.create({
      data: { ownerId, title, description, kind: KIND[detected.kind], ...stored, shares: { create: shareRows(recipients) } },
      include: drawingInclude,
    });
  } catch (error) {
    await deleteDrawingFile(stored.publicId, detected.kind);
    throw error;
  }

  // 4. Tell the people it was shared with (in the background: a slow push service never delays the upload)
  notifyDrawingShared(row, recipients);
  return toDrawingDto(row, ownerId);
}

/** Replaces the whole list of people a drawing is shared with. Only the owner may do this. */
export async function replaceShares(ownerId: string, drawingId: string, requested: string[]) {
  const owned = await prisma.drawing.findFirst({ where: { id: drawingId, ownerId }, select: { id: true, shares: { select: { userId: true } } } });
  if (!owned) throw new HttpError(404, "Drawing not found");

  const recipients = await resolveRecipients(ownerId, requested);
  const already = new Set(owned.shares.map((share) => share.userId));
  const row = await prisma.drawing.update({
    where: { id: drawingId },
    data: { shares: { deleteMany: {}, create: shareRows(recipients) } }, // one statement: all or nothing
    include: drawingInclude,
  });

  // Only the people newly added hear about it, not everyone each time the list is changed
  notifyDrawingShared(row, recipients.filter((id) => !already.has(id)));
  return toDrawingDto(row, ownerId);
}

/** Deletes the record first (so it disappears at once), then the file. Only the owner may do this. */
export async function deleteDrawing(ownerId: string, drawingId: string) {
  const drawing = await prisma.drawing.findFirst({ where: { id: drawingId, ownerId }, select: { id: true, publicId: true, kind: true } });
  if (!drawing) throw new HttpError(404, "Drawing not found");

  await prisma.drawing.delete({ where: { id: drawing.id } });
  await deleteDrawingFile(drawing.publicId, kindOf(drawing));
}
