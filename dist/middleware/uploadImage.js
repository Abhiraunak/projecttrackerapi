import multer from "multer";
import { HttpError } from "../lib/error.js";
/** Pictures up to 10 MB; PDF and AutoCAD drawings, which are often bigger, up to 25 MB */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
// Memory storage: the file is held only while it is passed on to Cloudinary, never saved to disk.
// The limit here is the larger one; the service checks the right limit once it knows what the file is.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 60, fieldSize: 10 * 1024 },
});
const MESSAGES = {
    LIMIT_FILE_SIZE: { status: 413, message: "That file is larger than 25 MB." },
    LIMIT_FILE_COUNT: { status: 400, message: "Upload one file at a time." },
    LIMIT_UNEXPECTED_FILE: { status: 400, message: "Upload the file in the 'file' field." },
    LIMIT_FIELD_COUNT: { status: 400, message: "Too many fields in the upload." },
    LIMIT_FIELD_VALUE: { status: 400, message: "One of the fields is too long." },
};
/** Reads a single file from the "file" field of a multipart form and turns multer's errors into clean 4xx responses */
export const uploadSingleImage = (req, res, next) => {
    upload.single("file")(req, res, (error) => {
        if (!error)
            return next();
        if (error instanceof multer.MulterError) {
            const known = MESSAGES[error.code] ?? { status: 400, message: "The upload could not be read." };
            return next(new HttpError(known.status, known.message));
        }
        next(error);
    });
};
/** A clearer name for the same thing */
export const uploadSingleFile = uploadSingleImage;
//# sourceMappingURL=uploadImage.js.map