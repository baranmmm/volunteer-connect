import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireMember } from "@/lib/require-member";
import { youtubeId } from "./youtube";

export type EventVideo = {
  id: string;
  youtube_id: string;
  title: string;
  has_thumb: boolean;
  position: number;
  /** Five-minute signed link to the stored poster (null when there is none). */
  thumb_url: string | null;
};

/** Videos of an event (anyone who can view the event). */
export const listEventVideos = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ eventId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc("list_event_videos", { p_event: data.eventId });
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as Omit<EventVideo, "thumb_url">[];
    const posters = rows.filter((v) => v.has_thumb).map((v) => `videos/${v.id}.jpg`);
    const urls = new Map<string, string>();
    if (posters.length) {
      // The RPC checked that the viewer may see the event; posters live outside the event folders, so sign them here.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const signed = await supabaseAdmin.storage.from("event-media").createSignedUrls(posters, 300);
      for (const s of signed.data ?? []) {
        if (!s.signedUrl || !s.path) continue;
        const raw = new URL(s.signedUrl);
        urls.set(s.path, `${import.meta.env["VITE_SUPABASE_URL"]}${raw.pathname}${raw.search}`);
      }
    }
    return rows.map((v) => ({ ...v, thumb_url: urls.get(`videos/${v.id}.jpg`) ?? null }));
  });

/**
 * Adds a YouTube video to a public event: the RPC checks the manager's scope, then the server stores the title and
 * poster (fetched from YouTube by the server, stored with the service role).
 */
export const addEventVideo = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ eventId: z.string().uuid(), url: z.string().trim().min(1).max(2000) }))
  .handler(async ({ data, context }) => {
    const id = youtubeId(data.url);
    if (!id) throw new Error("Invalid YouTube link");
    const { youtubeTitle, storeVideoPoster } = await import("./event-videos.server");
    const title = await youtubeTitle(id);
    const added = await context.supabase.rpc("add_event_video", {
      p_event: data.eventId,
      p_youtube_id: id,
      p_title: title,
    });
    if (added.error) throw new Error(added.error.message);
    const videoId = String(added.data);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await storeVideoPoster(supabaseAdmin, videoId, id);
    return { id: videoId, youtubeId: id, title };
  });

/** Removes a video: the stored poster first (Storage), then the row. */
export const removeEventVideo = createServerFn({ method: "POST" })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const path = await context.supabase.rpc("get_event_video_for_removal", { p_id: data.id });
    if (path.error) throw new Error(path.error.message);
    if (path.data) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const removed = await supabaseAdmin.storage.from("event-media").remove([String(path.data)]);
      if (removed.error) throw new Error(removed.error.message);
    }
    const result = await context.supabase.rpc("delete_event_video", { p_id: data.id });
    if (result.error) throw new Error(result.error.message);
  });
