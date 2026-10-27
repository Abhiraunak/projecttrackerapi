/**
 * Works out what a drawing file really is from its first bytes, not its name or the type the browser claimed
 * (both can be faked). Anything not recognised is refused.
 *
 *   image: PNG, JPEG, WebP, GIF   -> stored as an image: thumbnails and previews
 *   pdf:   PDF                    -> stored as an image too, so page 1 gets a thumbnail; the PDF itself is downloadable
 *   cad:   AutoCAD DWG, DXF, DWF  -> stored as a plain file (browsers can't draw them): download to open
 */
const startsWith = (buffer, bytes, offset = 0) => bytes.every((byte, i) => buffer[offset + i] === byte);
const ascii = (buffer, length) => buffer.subarray(0, length).toString("latin1");
/** DXF text files open with a group code 0 and "SECTION" (an optional 999 comment line may come first) */
const DXF_TEXT = /^\s*(?:999\s*\r?\n[^\r\n]*\r?\n\s*)?0\s*\r?\n\s*SECTION\s*\r?\n/;
/** DWG files open with their version: AC1032 (2018+), AC1027 (2013), ... AC1012, or AC1.40 / AC2.10 for very old ones */
const DWG = /^AC(?:10[0-3]\d|1\.\d\d?|2\.\d\d?)/;
export function detectFileType(buffer) {
    if (buffer.length < 4)
        return null;
    if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        return { kind: "image", format: "png" };
    if (startsWith(buffer, [0xff, 0xd8, 0xff]))
        return { kind: "image", format: "jpg" };
    if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38]) && (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61) {
        return { kind: "image", format: "gif" };
    }
    if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8))
        return { kind: "image", format: "webp" };
    if (ascii(buffer, 5) === "%PDF-")
        return { kind: "pdf", format: "pdf" };
    if (DWG.test(ascii(buffer, 6)))
        return { kind: "cad", format: "dwg" };
    if (ascii(buffer, 6) === "(DWF V")
        return { kind: "cad", format: "dwf" };
    if (ascii(buffer, 18) === "AutoCAD Binary DXF")
        return { kind: "cad", format: "dxf" };
    if (DXF_TEXT.test(ascii(buffer, 256)))
        return { kind: "cad", format: "dxf" };
    return null;
}
/** For error messages and the upload hint */
export const ACCEPTED_DESCRIPTION = "PNG, JPG, WebP, GIF, PDF or AutoCAD (DWG, DXF, DWF)";
//# sourceMappingURL=fileType.js.map