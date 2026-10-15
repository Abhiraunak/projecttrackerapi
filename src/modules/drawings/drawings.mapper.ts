import { imageUrls } from "../../lib/cloudinary.js";
import type { DrawingRow } from "./drawings.types.js";

const mimeFor = (format: string) => `image/${format === "jpg" ? "jpeg" : format}`;

/** Database row -> the JSON the frontend expects, as seen by one particular viewer */
export function toDrawingDto(row: DrawingRow, viewerId: string) {
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
