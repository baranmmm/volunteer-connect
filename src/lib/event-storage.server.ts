import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Bucket = ReturnType<SupabaseClient<Database>["storage"]["from"]>;

/**
 * Whether an object is stored. storage-js reports a missing object as `{ data: false, error }` (not found), so only an
 * error without that answer (or a thrown one) is a failure.
 */
async function stored(bucket: Bucket, path: string): Promise<boolean> {
  let result: Awaited<ReturnType<Bucket["exists"]>>;
  try {
    result = await bucket.exists(path);
  } catch {
    throw new Error("Event deletion cleanup failed");
  }
  if (result.data === true) return true;
  if (result.data === false) return false;
  throw new Error("Event deletion cleanup failed");
}

/** Move rather than copy: tokens for the old path stop finding an object. Image copies (.w640/.w1280) move the same way. */
export async function relocateEventFiles(
  client: SupabaseClient<Database>,
  paths: string[],
  restoring = false,
) {
  const bucket = client.storage.from("event-media");
  for (const path of paths) {
    const source = restoring ? `deleted/${path}` : path;
    const target = restoring ? path : `deleted/${path}`;
    // Already moved, or an upload reservation that never acquired a file: restore validates records, and a
    // reservation without an object is removed by the restore finalization RPC.
    if (!(await stored(bucket, source))) continue;
    const moved = await bucket.move(source, target);
    if (moved.error) throw new Error("Event deletion cleanup failed");
  }
}
