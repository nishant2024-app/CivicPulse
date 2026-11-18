import { createHash } from "node:crypto";
import sharp from "sharp";
import { AppError } from "../../errors";
import type { ProcessedImage } from "./service";

/** Identify the format from the file's first bytes; the client's claims are ignored. */
function sniff(buffer: Buffer): "jpeg" | "png" | "webp" | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * Validate and normalize an uploaded photo. Re-encoding drops EXIF metadata (including
 * GPS position) and anything appended to the file that is not image data.
 */
export async function processImage(
  input: Buffer,
  options: { thumbnail: boolean } = { thumbnail: true },
): Promise<ProcessedImage> {
  if (!sniff(input)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Upload a JPEG, PNG or WebP photo");
  }
  try {
    // limitInputPixels guards against decompression bombs.
    const source = sharp(input, { limitInputPixels: 40_000_000, failOn: "error" }).rotate();
    const full = await source
      .clone()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = options.thumbnail
      ? await source
          .clone()
          .resize({ width: 480, height: 480, fit: "cover" })
          .webp({ quality: 72 })
          .toBuffer()
      : null;
    return {
      full: full.data,
      thumbnail,
      width: full.info.width,
      height: full.info.height,
      checksum: createHash("sha256").update(full.data).digest("hex"),
    };
  } catch {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "That file is not a readable image");
  }
}
