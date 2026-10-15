import { v2 as cloudinary, type UploadApiErrorResponse, type UploadApiResponse } from "cloudinary";
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
 * "authenticated" means a file can only be fetched through a signed link that this server makes.
 * Nobody can guess a link from the file name. To make links public instead, change this to
 * `{ type: "upload", resource_type: "image", secure: true }` (and delete sign_url).
 */
const DELIVERY = { type: "authenticated", resource_type: "image", sign_url: true, secure: true } as const;

export interface StoredImage {
  publicId: string;
  version: number;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

/** Sends the image to Cloudinary. Nothing is written to this server's disk. */
export function uploadImage(buffer: Buffer): Promise<StoredImage> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: env.CLOUDINARY_FOLDER,
        resource_type: "image",
        type: DELIVERY.type,
        allowed_formats: ["png", "jpg", "jpeg", "webp", "gif"],
        use_filename: false, // random names: the uploaded file name is never part of the link
        unique_filename: true,
        overwrite: false,
      },
      (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
        if (error || !result) {
          logger.error({ err: error }, "cloudinary upload failed");
          reject(new HttpError(502, "Image storage is unavailable right now. Please try again."));
          return;
        }
        resolve({
          publicId: result.public_id,
          version: result.version,
          format: result.format,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
        });
      }
    );
    stream.end(buffer);
  });
}

/** Removes the file. A failure is logged, not thrown, so a deleted drawing never reappears because of it. */
export async function deleteImage(publicId: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image", type: DELIVERY.type, invalidate: true });
  } catch (err) {
    logger.error({ err, publicId }, "cloudinary delete failed: file left behind");
  }
}

/**
 * The three links the app needs, computed locally (no call to Cloudinary):
 *  - thumbnail: small, for the grid
 *  - image: full size but compressed and in the best format for the browser
 *  - download: the untouched original, sent as a download
 */
export function imageUrls({ publicId, version, format }: Pick<StoredImage, "publicId" | "version" | "format">) {
  return {
    thumbnailUrl: cloudinary.url(publicId, {
      ...DELIVERY,
      version,
      transformation: [{ width: 800, crop: "limit", quality: "auto", fetch_format: "auto" }],
    }),
    imageUrl: cloudinary.url(publicId, {
      ...DELIVERY,
      version,
      transformation: [{ width: 2400, crop: "limit", quality: "auto", fetch_format: "auto" }],
    }),
    downloadUrl: cloudinary.url(publicId, { ...DELIVERY, version, format, flags: "attachment" }),
  };
}
