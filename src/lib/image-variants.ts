// Resized WebP copies of event images (covers and gallery photos). Each image row may have two copies next to the
// original in its event folder: `<path without extension>.w640.webp` and `.w1280.webp` (long side at most 640/1280 px,
// never upscaled). The paths must match public.event_media_variant_paths in SQL. Pure helpers: shared by the browser
// upload, the server signing, the import and the backfill scripts.

export const IMAGE_VARIANT_SIDES = [640, 1280] as const;
export type ImageVariantSide = (typeof IMAGE_VARIANT_SIDES)[number];
/** WebP quality of the copies made in the browser (canvas, 0..1). */
export const IMAGE_VARIANT_QUALITY = 0.8;

/** The two copy paths of an original image path (event_media_variant_paths). */
export function imageVariantPaths(path: string): { w640: string; w1280: string } {
  const base = path.replace(/\.[A-Za-z0-9]+$/, "");
  return { w640: `${base}.w640.webp`, w1280: `${base}.w1280.webp` };
}

/** Both copy paths as a list, smaller first. */
export function imageVariantPathList(path: string): string[] {
  const { w640, w1280 } = imageVariantPaths(path);
  return [w640, w1280];
}

/** The pixel size of a copy: long side at most `side`, never upscaled. */
export function imageVariantSize(width: number, height: number, side: number) {
  const ratio = Math.min(1, side / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** A signed image for the public pages: browser-facing links only, never storage paths. */
export type SignedImage = {
  /** The default source: the 1280 copy when copies exist, otherwise the original. */
  src: string;
  /** The small source (thumbnails): the 640 copy when copies exist, otherwise the original. */
  small: string;
  /** `<w640> 640w, <w1280> 1280w[, <original> <width>w]`, or null without copies. */
  srcSet: string | null;
  width: number | null;
  height: number | null;
};

/**
 * Builds the sources of one image. With the original's size known, the width descriptors are the copies' real widths
 * (portrait photos are narrower than their long side) and the original is listed only when it is wider than the 1280
 * copy; equal widths are listed once. Without a size, the copies are described as 640w and 1280w.
 */
export function buildSignedImage(input: {
  original: string;
  w640?: string | null;
  w1280?: string | null;
  width?: number | null;
  height?: number | null;
}): SignedImage {
  const width = input.width ?? null,
    height = input.height ?? null;
  const base = { width, height };
  if (!input.w640 || !input.w1280)
    return { ...base, src: input.original, small: input.original, srcSet: null };
  const sized = width && height;
  const candidates: [string, number][] = [
    [input.w640, sized ? imageVariantSize(width, height, 640).width : 640],
    [input.w1280, sized ? imageVariantSize(width, height, 1280).width : 1280],
  ];
  if (sized) candidates.push([input.original, width]);
  const seen = new Set<number>();
  const entries = candidates.filter(([, w]) => (seen.has(w) ? false : (seen.add(w), true)));
  return {
    ...base,
    src: input.w1280,
    small: input.w640,
    srcSet: entries.map(([url, w]) => `${url} ${w}w`).join(", "),
  };
}
