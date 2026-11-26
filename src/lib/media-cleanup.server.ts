// Server only (service role): the nightly Media sweep. media_cleanup_paths() marks what must leave Storage —
// discarded upload request files, photos being deleted, photos whose event was purged, unfinished uploads and
// requests abandoned while uploading — and lists their stored files (originals and copies). They are deleted through
// Storage (never SQL), then clear_deleted_media() removes the rows whose files are gone. Returns the files removed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_BUCKET } from "@/lib/media";

export async function sweepMediaLibrary(client: SupabaseClient): Promise<number> {
  const listed = await client.rpc("media_cleanup_paths");
  if (listed.error) throw new Error(listed.error.message);
  const paths = ((listed.data as { paths?: string[] } | null)?.paths ?? []).filter(
    (p) => typeof p === "string",
  );
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await client.storage.from(MEDIA_BUCKET).remove(batch);
    if (error) throw new Error(error.message);
    removed += batch.length;
  }
  const cleared = await client.rpc("clear_deleted_media");
  if (cleared.error) throw new Error(cleared.error.message);
  return removed;
}
