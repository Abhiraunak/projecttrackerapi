import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { HttpError } from "./error.js";
cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
});
/**
 * Where each kind of file lives on Cloudinary:
 *  - images and PDFs are "image" resources, so Cloudinary can make thumbnails (for a PDF, of page 1)
 *  - AutoCAD files are "raw" resources: stored and delivered as they are
 * "authenticated" means a file can only be fetched through a signed link made by this server.
 */
const resourceTypeFor = (kind) => (kind === "cad" ? "raw" : "image");
const delivery = (kind) => ({ type: "authenticated", resource_type: resourceTypeFor(kind), sign_url: true, secure: true });
function uploadOptions(detected) {
    const common = { folder: env.CLOUDINARY_FOLDER, type: "authenticated", overwrite: false };
    if (detected.kind === "cad") {
        // Raw files keep their extension only if it is part of the id; the id is random, never the uploaded name
        return { ...common, resource_type: "raw", public_id: `${randomUUID()}.${detected.format}` };
    }
    return {
        ...common,
        resource_type: "image",
        allowed_formats: ["png", "jpg", "jpeg", "webp", "gif", "pdf"],
        use_filename: false,
        unique_filename: true,
    };
}
/** Sends the file to Cloudinary. Nothing is written to this server's disk. */
export function uploadDrawingFile(buffer, detected) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(uploadOptions(detected), (error, result) => {
            if (error?.http_code === 400 && /too large/i.test(error.message ?? "")) {
                reject(new HttpError(413, "That file is larger than your Cloudinary plan allows (the free plan allows 10 MB per file)."));
                return;
            }
            if (error || !result) {
                logger.error({ err: error }, "cloudinary upload failed");
                reject(new HttpError(502, "File storage is unavailable right now. Please try again."));
                return;
            }
            resolve({
                publicId: result.public_id,
                version: result.version,
                format: detected.format, // raw uploads report no format, so use what was detected
                bytes: result.bytes,
                width: detected.kind === "cad" ? null : (result.width ?? null),
                height: detected.kind === "cad" ? null : (result.height ?? null),
                pages: detected.kind === "pdf" ? (result.pages ?? null) : null,
            });
        });
        stream.end(buffer);
    });
}
/** Removes the file. A failure is logged, not thrown, so a deleted drawing never reappears because of it. */
export async function deleteDrawingFile(publicId, kind) {
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceTypeFor(kind), type: "authenticated", invalidate: true });
    }
    catch (err) {
        logger.error({ err, publicId }, "cloudinary delete failed: file left behind");
    }
}
/** The links the app needs, computed locally (no call to Cloudinary) */
export function drawingUrls({ publicId, version, format, kind }) {
    const base = { ...delivery(kind), version };
    if (kind === "cad") {
        const file = cloudinary.url(publicId, base);
        return { thumbnailUrl: null, imageUrl: null, openUrl: file, downloadUrl: file };
    }
    // For a PDF, "page: 1" and format jpg turn page 1 into a picture
    const picture = (width) => cloudinary.url(publicId, {
        ...base,
        ...(kind === "pdf" ? { format: "jpg" } : {}),
        transformation: [{ ...(kind === "pdf" ? { page: 1 } : {}), width, crop: "limit", quality: "auto", ...(kind === "pdf" ? {} : { fetch_format: "auto" }) }],
    });
    return {
        thumbnailUrl: picture(800),
        imageUrl: picture(2400),
        openUrl: cloudinary.url(publicId, { ...base, format }),
        downloadUrl: cloudinary.url(publicId, { ...base, format, flags: "attachment" }),
    };
}
//# sourceMappingURL=cloudinary.js.map