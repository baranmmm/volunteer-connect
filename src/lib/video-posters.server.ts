// Nightly sweep of YouTube poster files (event-media/videos/<video id>.jpg) that no event_videos row references any
// more — e.g. after an event and its videos were purged from the Recycle Bin (the poster is not one of the event's
// files). Files younger than an hour are left alone: a poster is uploaded just before its row points at it.
// Server only (service role). Returns how many files were removed.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const PREFIX = "videos";
const MIN_AGE_MS = 60 * 60 * 1000;

export async function sweepOrphanVideoPosters(admin: SupabaseClient<Database>): Promise<number> {
  const bucket = admin.storage.from("event-media");
  const { data: referenced, error } = await admin
    .from("event_videos")
    .select("thumb_path")
    .not("thumb_path", "is", null);
  if (error) throw new Error("Video poster cleanup failed");
  const keep = new Set((referenced ?? []).map((r) => r.thumb_path));
  const orphans: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: files, error: listError } = await bucket.list(PREFIX, { limit: 1000, offset });
    if (listError) throw new Error("Video poster cleanup failed");
    for (const f of files ?? []) {
      const path = `${PREFIX}/${f.name}`;
      const created = Date.parse(f.created_at ?? "");
      if (
        !keep.has(path) &&
        /\.jpg$/.test(f.name) &&
        Number.isFinite(created) &&
        Date.now() - created > MIN_AGE_MS
      )
        orphans.push(path);
    }
    if (!files || files.length < 1000) break;
  }
  for (let i = 0; i < orphans.length; i += 100) {
    const { error: removeError } = await bucket.remove(orphans.slice(i, i + 100));
    if (removeError) throw new Error("Video poster cleanup failed");
  }
  return orphans.length;
}
