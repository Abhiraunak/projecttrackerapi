import { drawingUrls } from "../../lib/cloudinary.js";
import type { FileKind } from "../../lib/fileType.js";
import type { DrawingRow } from "./drawings.types.js";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  dwg: "image/vnd.dwg",
  dxf: "image/vnd.dxf",
  dwf: "model/vnd.dwf",
};

export const kindOf = (row: { kind: "IMAGE" | "PDF" | "CAD" }): FileKind => (row.kind === "PDF" ? "pdf" : row.kind === "CAD" ? "cad" : "image");

/** Database row -> the JSON the frontend expects, as seen by one particular viewer */
export function toDrawingDto(row: DrawingRow, viewerId: string) {
  const isOwner = row.ownerId === viewerId;
  const kind = kindOf(row);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind,
    format: row.format,
    pageCount: row.pages,
    ...drawingUrls({ ...row, kind }),
    mimeType: MIME[row.format] ?? "application/octet-stream",
    sizeBytes: row.bytes,
    owner: row.owner,
    isOwner,
    sharedWith: isOwner ? row.shares.map((share) => share.user) : [], // other people's access list is the owner's business
    createdAt: row.createdAt,
  };
}
