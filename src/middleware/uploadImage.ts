import type { RequestHandler } from "express";
import multer from "multer";
import { HttpError } from "../lib/error.js";


export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Memory storage: the file is held only while it is passed on to Cloudinary, never saved to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 60, fieldSize: 10 * 1024 },
});

const MESSAGES: Record<string, { status: number; message: string }> = {
  LIMIT_FILE_SIZE: { status: 413, message: "That image is larger than 10 MB." },
  LIMIT_FILE_COUNT: { status: 400, message: "Upload one image at a time." },
  LIMIT_UNEXPECTED_FILE: { status: 400, message: "Upload the image in the 'file' field." },
  LIMIT_FIELD_COUNT: { status: 400, message: "Too many fields in the upload." },
  LIMIT_FIELD_VALUE: { status: 400, message: "One of the fields is too long." },
};

/** Reads a single image from the "file" field of a multipart form and turns multer's errors into clean 4xx responses */
export const uploadSingleImage: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const known = MESSAGES[error.code] ?? { status: 400, message: "The upload could not be read." };
      return next(new HttpError(known.status, known.message));
    }
    next(error);
  });
};
