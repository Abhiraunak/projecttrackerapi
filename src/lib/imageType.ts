export type DetectedImageType = "png" | "jpeg" | "webp" | "gif";

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) => bytes.every((byte, i) => buffer[offset + i] === byte);

/**
 * Looks at the first bytes of the file, not its name or the type the browser claimed (both can be faked).
 * Returns null for anything that isn't a PNG, JPEG, WebP or GIF.
 */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38]) && (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61) return "gif";
  // WebP is "RIFF", 4 size bytes, then "WEBP"
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}
