import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan } from "../../lib/projectAccess.js";
import { isUniqueViolation } from "../../lib/prismaErrors.js";
import { deleteDrawingFile, uploadDrawingFile } from "../../lib/cloudinary.js";
import { ACCEPTED_DESCRIPTION, detectFileType } from "../../lib/fileType.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { toDrawingDto } from "./drawings.mapper.js";
import { drawingInclude } from "./drawings.types.js";
import { compareNumbers, normalizeNumber, revisionLabel } from "./drawings.calc.js";

/*
 * Phase 4: drawings by project and number.
 *
 * A drawing placed in a project is a project document: everyone allowed to use drawings sees it there (access is
 * company-wide, like the rest of the app). Drawings not placed in a project keep today's rule: owner and the people
 * it was shared with.
 *
 * Each revision is its own row with its own file. Uploading an existing number makes a new revision; the previous
 * one is kept as history (current = false), never overwritten.
 */

const KIND = { image: "IMAGE", pdf: "PDF", cad: "CAD" } as const;

function cleanNumber(raw: string): string {
  const number = normalizeNumber(raw);
  if (!number) throw new HttpError(400, "Enter a drawing number such as A-1.00 (letters, numbers, - . / only).");
  return number;
}

async function requireProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new HttpError(404, "Project not found");
}

/** The project's drawings, latest revision of each number, in number order; plus how many old drawings await sorting */
export async function listProjectDrawings(userId: string, projectId: string) {
  const access = await requireCan(userId, "drawings.use");
  await requireProject(projectId);

  const [rows, counts, unassigned] = await Promise.all([
    prisma.drawing.findMany({ where: { projectId, current: true }, include: drawingInclude }),
    prisma.drawing.groupBy({ by: ["number"], where: { projectId }, _count: true }),
    // Admins sort everyone's old drawings; anyone else their own
    prisma.drawing.count({ where: { projectId: null, ...(access.isAdmin ? {} : { ownerId: userId }) } }),
  ]);
  const revisionsOf = new Map(counts.map((c) => [c.number, c._count]));

  return {
    drawings: rows
      .sort((a, b) => compareNumbers(a.number ?? "", b.number ?? ""))
      .map((row) => ({ ...toDrawingDto(row, userId), revisions: revisionsOf.get(row.number) ?? 1 })),
    unassigned,
  };
}

/** Every revision of one numbered drawing, newest first */
export async function drawingRevisions(userId: string, drawingId: string) {
  await requireCan(userId, "drawings.use");
  const drawing = await prisma.drawing.findUnique({ where: { id: drawingId }, select: { projectId: true, number: true } });
  if (!drawing?.projectId || !drawing.number) throw new HttpError(404, "Drawing not found");

  const rows = await prisma.drawing.findMany({
    where: { projectId: drawing.projectId, number: drawing.number },
    include: drawingInclude,
    orderBy: { revision: "desc" },
  });
  return { revisions: rows.map((row) => toDrawingDto(row, userId)) };
}

interface UploadInput {
  userId: string;
  projectId: string;
  number: string;
  title: string;
  description: string;
  file: Express.Multer.File;
}

/** Upload into a project under a number. An existing number becomes its next revision. */
export async function uploadProjectDrawing({ userId, projectId, number: rawNumber, title, description, file }: UploadInput) {
  await requireCan(userId, "drawings.use");
  await requireProject(projectId);
  const number = cleanNumber(rawNumber);

  // Cheap checks first, so a bad request never costs an upload
  const detected = detectFileType(file.buffer);
  if (!detected) throw new HttpError(415, `Only ${ACCEPTED_DESCRIPTION} files are allowed.`);
  if (detected.kind === "image" && file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Images can be up to 10 MB.");

  const stored = await uploadDrawingFile(file.buffer, detected);

  try {
    const row = await prisma.$transaction(async (tx) => {
      const latest = await tx.drawing.findFirst({ where: { projectId, number }, orderBy: { revision: "desc" }, select: { revision: true } });
      if (latest) await tx.drawing.updateMany({ where: { projectId, number, current: true }, data: { current: false } });
      return tx.drawing.create({
        data: {
          ownerId: userId,
          title,
          description,
          kind: KIND[detected.kind],
          ...stored,
          projectId,
          number,
          revision: latest ? latest.revision + 1 : 0,
          current: true,
        },
        include: drawingInclude,
      });
    });
    return { drawing: toDrawingDto(row, userId), revisedFrom: row.revision > 0 ? revisionLabel(row.revision - 1) : null };
  } catch (error) {
    await deleteDrawingFile(stored.publicId, detected.kind); // never leave an orphan file behind
    if (isUniqueViolation(error)) throw new HttpError(409, `Someone uploaded ${number} at the same moment. Try again.`);
    throw error;
  }
}

/** Old drawings not yet in any project: an admin sees everyone's, anyone else their own */
export async function listUnassigned(userId: string) {
  const access = await requireCan(userId, "drawings.use");
  const rows = await prisma.drawing.findMany({
    where: { projectId: null, ...(access.isAdmin ? {} : { ownerId: userId }) },
    include: drawingInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  return { drawings: rows.map((row) => toDrawingDto(row, userId)) };
}

/**
 * Place an old drawing in a project under a number (the one-time sort after Phase 4 goes live).
 * Its owner or an admin may do it. A number already used in that project is refused, so nothing is overwritten.
 */
export async function placeDrawing(userId: string, drawingId: string, input: { projectId: string; number: string }) {
  const access = await requireCan(userId, "drawings.use");
  const number = cleanNumber(input.number);
  await requireProject(input.projectId);

  const drawing = await prisma.drawing.findUnique({ where: { id: drawingId }, select: { ownerId: true, projectId: true } });
  if (!drawing || (drawing.ownerId !== userId && !access.isAdmin)) throw new HttpError(404, "Drawing not found");
  if (drawing.projectId) throw new HttpError(409, "This drawing is already in a project.");

  const taken = await prisma.drawing.findFirst({ where: { projectId: input.projectId, number }, select: { id: true } });
  if (taken) throw new HttpError(409, `${number} is already used in this project. Choose another number, or upload the file as a new revision of ${number}.`);

  try {
    const row = await prisma.drawing.update({
      where: { id: drawingId },
      data: { projectId: input.projectId, number, revision: 0, current: true },
      include: drawingInclude,
    });
    return { drawing: toDrawingDto(row, userId) };
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, `${number} was just used by someone else. Choose another number.`);
    throw error;
  }
}
