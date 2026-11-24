// Resized WebP copies of an event image, made with sharp (Node). Shared by the backfill and the past-events import.
// Same paths and sizes as the browser upload (src/lib/image-variants.ts): long side 640 and 1280 px, never upscaled.
import sharp from "sharp";
import { imageVariantPaths } from "../../src/lib/image-variants";

export const COPY_QUALITY = 78;

export { imageVariantPaths };

async function copy(input: Buffer, side: number): Promise<Buffer> {
  // rotate() applies any EXIF orientation; sharp writes no metadata unless asked, so EXIF/GPS are dropped.
  return sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
    .webp({ quality: COPY_QUALITY })
    .toBuffer();
}

/** The 640 and 1280 px copies of an image, plus its displayed size (orientation applied). */
export async function makeImageCopies(input: Buffer) {
  const meta = await sharp(input, { failOn: "error" }).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const width = (turned ? meta.height : meta.width) ?? null;
  const height = (turned ? meta.width : meta.height) ?? null;
  return { w640: await copy(input, 640), w1280: await copy(input, 1280), width, height };
}
