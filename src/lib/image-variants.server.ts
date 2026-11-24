// Server only: signs event images for the public pages, with their resized copies when they exist. Reads
// event_media.has_variants with the service role and signs the original and both copies in one createSignedUrls
// batch (5-minute links on the browser's Supabase origin). Only call it for paths the caller has already checked are
// public; the paths themselves never leave the server.
import { buildSignedImage, imageVariantPaths, type SignedImage } from "@/lib/image-variants";

const SIGNED_SECONDS = 300;

type Known = { has_variants: boolean; width: number | null; height: number | null };

/** Signed images by original storage path (paths that could not be signed are missing from the map). */
export async function signEventImages(paths: string[]): Promise<Map<string, SignedImage>> {
  const unique = [...new Set(paths)];
  const result = new Map<string, SignedImage>();
  if (!unique.length) return result;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const known = new Map<string, Known>();
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from("event_media")
      .select("storage_path, has_variants, width, height")
      .eq("kind", "image")
      .in("storage_path", unique.slice(i, i + 100));
    // Without the flags the originals are still signed (no copies): a page never fails over them.
    if (error) break;
    for (const row of data) known.set(row.storage_path, row);
  }
  const toSign = unique.flatMap((path) => {
    if (!known.get(path)?.has_variants) return [path];
    const { w640, w1280 } = imageVariantPaths(path);
    return [path, w640, w1280];
  });
  const { data, error } = await supabaseAdmin.storage
    .from("event-media")
    .createSignedUrls(toSign, SIGNED_SECONDS);
  if (error || !data) return result;
  const origin = import.meta.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const urls = new Map<string, string>();
  for (const item of data) {
    if (item.error || !item.signedUrl || !item.path) continue;
    const raw = new URL(item.signedUrl);
    urls.set(item.path, `${origin}${raw.pathname}${raw.search}`);
  }
  for (const path of unique) {
    const original = urls.get(path);
    if (!original) continue;
    const row = known.get(path);
    const copies = row?.has_variants ? imageVariantPaths(path) : null;
    result.set(
      path,
      buildSignedImage({
        original,
        w640: copies ? (urls.get(copies.w640) ?? null) : null,
        w1280: copies ? (urls.get(copies.w1280) ?? null) : null,
        width: row?.width ?? null,
        height: row?.height ?? null,
      }),
    );
  }
  return result;
}
