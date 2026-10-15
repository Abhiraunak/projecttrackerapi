import { prisma } from "../../lib/prisma.js";
import { deleteImage, uploadImage } from "../../lib/cloudinary.js";
import { detectImageType } from "../../lib/imageType.js";
import { toDrawingDto } from "./drawings.mapper.js";
import { drawingInclude } from "./drawings.types.js";
import { HttpError } from "../../lib/error.js";
/* ------------------------------ small helpers ----------------------------- */
/** Which drawings this person may see for the chosen tab */
function scopeFilter(scope, viewerId) {
    const mine = { ownerId: viewerId };
    const shared = { shares: { some: { userId: viewerId } } };
    if (scope === "mine")
        return mine;
    if (scope === "shared")
        return shared;
    return { OR: [mine, shared] };
}
function searchFilter(q) {
    if (!q)
        return {};
    return {
        OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
        ],
    };
}
/** Removes duplicates and the owner, and makes sure every chosen person really exists */
async function resolveRecipients(ownerId, requested) {
    const ids = [...new Set(requested)].filter((id) => id !== ownerId);
    if (ids.length === 0)
        return [];
    const found = await prisma.user.count({ where: { id: { in: ids } } });
    if (found !== ids.length)
        throw new HttpError(400, "One or more people you chose could not be found.");
    return ids;
}
const shareRows = (userIds) => userIds.map((userId) => ({ userId }));
/* ------------------------------- operations ------------------------------- */
export async function listDrawings(viewerId, { scope, q, page, pageSize }) {
    const where = { AND: [scopeFilter(scope, viewerId), searchFilter(q)] };
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
export async function createDrawing({ ownerId, title, description, sharedWith, file }) {
    // 1. Cheap checks first, so a bad request never costs an upload
    if (!detectImageType(file.buffer))
        throw new HttpError(415, "Only PNG, JPG, WebP or GIF images are allowed.");
    const recipients = await resolveRecipients(ownerId, sharedWith);
    // 2. The image goes to Cloudinary
    const image = await uploadImage(file.buffer);
    // 3. Only the reference is saved. If saving fails, don't leave an orphan file behind.
    try {
        const row = await prisma.drawing.create({
            data: { ownerId, title, description, ...image, shares: { create: shareRows(recipients) } },
            include: drawingInclude,
        });
        return toDrawingDto(row, ownerId);
    }
    catch (error) {
        await deleteImage(image.publicId);
        throw error;
    }
}
/** Replaces the whole list of people a drawing is shared with. Only the owner may do this. */
export async function replaceShares(ownerId, drawingId, requested) {
    const owned = await prisma.drawing.findFirst({ where: { id: drawingId, ownerId }, select: { id: true } });
    if (!owned)
        throw new HttpError(404, "Drawing not found");
    const recipients = await resolveRecipients(ownerId, requested);
    const row = await prisma.drawing.update({
        where: { id: drawingId },
        data: { shares: { deleteMany: {}, create: shareRows(recipients) } }, // one statement: all or nothing
        include: drawingInclude,
    });
    return toDrawingDto(row, ownerId);
}
/** Deletes the record first (so it disappears at once), then the file. Only the owner may do this. */
export async function deleteDrawing(ownerId, drawingId) {
    const drawing = await prisma.drawing.findFirst({ where: { id: drawingId, ownerId }, select: { id: true, publicId: true } });
    if (!drawing)
        throw new HttpError(404, "Drawing not found");
    await prisma.drawing.delete({ where: { id: drawing.id } });
    await deleteImage(drawing.publicId);
}
//# sourceMappingURL=drawings.service.js.map