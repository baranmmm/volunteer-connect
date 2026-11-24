// YouTube details fetched by the server (never by the browser): the title (oEmbed) and the poster image, which is
// stored in the private event-media bucket with the service role so visitors never load images from YouTube.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const POSTER_MAX_BYTES = 1024 * 1024;

/** The video title from YouTube oEmbed, or "" (optional: a slow or failing lookup never blocks adding the video). */
export async function youtubeTitle(id: string): Promise<string> {
  try {
    const target = `https://www.youtube.com/watch?v=${id}`;
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`,
      { signal: AbortSignal.timeout(5000), redirect: "error" },
    );
    if (!response.ok) return "";
    const body = (await response.json()) as { title?: unknown };
    return typeof body.title === "string" ? body.title.trim().slice(0, 300) : "";
  } catch {
    return "";
  }
}

/** The hqdefault poster (JPEG, at most 1 MB), or null. */
export async function youtubePoster(id: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("image/jpeg"))
      return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > POSTER_MAX_BYTES || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > POSTER_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Stores the poster of a video at videos/<video id>.jpg and records it (service role). Never throws. */
export async function storeVideoPoster(
  admin: SupabaseClient<Database>,
  videoId: string,
  youtubeId: string,
): Promise<boolean> {
  const bytes = await youtubePoster(youtubeId);
  if (!bytes) return false;
  const path = `videos/${videoId}.jpg`;
  const uploaded = await admin.storage
    .from("event-media")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploaded.error) return false;
  const saved = await admin.rpc("set_event_video_thumb", { p_id: videoId, p_path: path });
  if (saved.error) {
    await admin.storage.from("event-media").remove([path]);
    return false;
  }
  return true;
}
