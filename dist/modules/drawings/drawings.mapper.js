import { imageUrls } from "../../lib/cloudinary.js";
const mimeFor = (format) => `image/${format === "jpg" ? "jpeg" : format}`;
/** Database row -> the JSON the frontend expects, as seen by one particular viewer */
export function toDrawingDto(row, viewerId) {
    const isOwner = row.ownerId === viewerId;
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        ...imageUrls(row),
        mimeType: mimeFor(row.format),
        sizeBytes: row.bytes,
        owner: row.owner,
        isOwner,
        sharedWith: isOwner ? row.shares.map((share) => share.user) : [], // other people's access list is the owner's business
        createdAt: row.createdAt,
    };
}
//# sourceMappingURL=drawings.mapper.js.map