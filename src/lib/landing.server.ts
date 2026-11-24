// Server-only data for the signed-out landing page (/). public_landing_data() is executable by the service role only;
// it returns public fields of public published events plus storage paths. Every path is signed here (5-minute links,
// one batch request) and the paths themselves never leave the server.
import { z } from "zod";
import { publicEventSchema } from "@/lib/public-events";

const SIGNED_SECONDS = 300;

const upcomingSchema = publicEventSchema.extend({
  location_tba: z.boolean().default(false),
  max_places: z.number().int().nullable().optional(),
  past_record: z.boolean().default(false),
  spots_left: z.number().int().nullable().optional(),
  image_path: z.string().nullable().optional(),
});
const gallerySchema = z.object({
  event_id: z.string().uuid(),
  title: z.string(),
  date: z.string().nullable(),
  branch: z.string().nullable(),
  region: z.string().nullable().optional(),
  description: z.string().nullable(),
  past_record: z.boolean().nullable(),
  photos: z
    .array(
      z.object({
        id: z.string().uuid(),
        path: z.string(),
        width: z.number().int().nullable(),
        height: z.number().int().nullable(),
      }),
    )
    .nullable(),
});
const highlightSchema = z.object({
  id: z.string().uuid(),
  youtube_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().nullable(),
  thumb_path: z.string().nullable(),
  event_id: z.string().uuid().nullable(),
});
const landingSchema = z.object({
  upcoming: z.array(upcomingSchema),
  gallery: z.array(gallerySchema),
  highlights: z.array(z.unknown()),
  stats: z.object({
    events_held: z.coerce.number(),
    registrations: z.coerce.number(),
    branches: z.coerce.number(),
  }),
});

export type LandingEvent = Omit<z.infer<typeof upcomingSchema>, "image_path"> & {
  image: string | null;
};
export type LandingPhoto = { id: string; url: string; width: number | null; height: number | null };
export type LandingGalleryGroup = {
  event_id: string;
  title: string;
  date: string | null;
  branch: string | null;
  photos: LandingPhoto[];
};
export type LandingHighlight = {
  id: string;
  youtube_id: string;
  title: string | null;
  poster: string | null;
};
export type LandingData = {
  upcoming: LandingEvent[];
  gallery: LandingGalleryGroup[];
  highlights: LandingHighlight[];
  stats: { events_held: number; registrations: number; branches: number };
  signedAt: number;
};

/** Signs storage paths in one request; the links point at the browser-facing Supabase origin. */
async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const result = new Map<string, string>();
  if (!unique.length) return result;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage
    .from("event-media")
    .createSignedUrls(unique, SIGNED_SECONDS);
  if (error || !data) return result;
  const origin = import.meta.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  for (const item of data) {
    if (item.error || !item.signedUrl || !item.path) continue;
    const raw = new URL(item.signedUrl);
    result.set(item.path, `${origin}${raw.pathname}${raw.search}`);
  }
  return result;
}

export async function fetchLanding(): Promise<LandingData> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("public_landing_data");
  if (error) throw new Error("Landing unavailable");
  const parsed = landingSchema.parse(data);
  // A malformed video row is skipped rather than failing the whole page.
  const highlights = parsed.highlights.flatMap((h) => {
    const ok = highlightSchema.safeParse(h);
    return ok.success ? [ok.data] : [];
  });
  const paths = [
    ...parsed.upcoming.flatMap((e) => (e.image_path ? [e.image_path] : [])),
    ...parsed.gallery.flatMap((g) => (g.photos ?? []).map((p) => p.path)),
    ...highlights.flatMap((h) => (h.thumb_path ? [h.thumb_path] : [])),
  ];
  const signed = await signPaths(paths);
  return {
    upcoming: parsed.upcoming.map(({ image_path, ...event }) => ({
      ...event,
      image: image_path ? (signed.get(image_path) ?? null) : null,
    })),
    gallery: parsed.gallery
      .map((g) => ({
        event_id: g.event_id,
        title: g.title,
        date: g.date,
        // Region records (no branch) are labelled with their region.
        branch: g.branch ?? g.region ?? null,
        photos: (g.photos ?? []).flatMap((p) => {
          const url = signed.get(p.path);
          return url ? [{ id: p.id, url, width: p.width, height: p.height }] : [];
        }),
      }))
      .filter((g) => g.photos.length > 0),
    highlights: highlights.map((h) => ({
      id: h.id,
      youtube_id: h.youtube_id,
      title: h.title,
      poster: h.thumb_path ? (signed.get(h.thumb_path) ?? null) : null,
    })),
    stats: parsed.stats,
    signedAt: Date.now(),
  };
}
