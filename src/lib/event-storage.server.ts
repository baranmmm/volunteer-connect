import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

/** Move rather than copy: tokens for the old path stop finding an object. */
export async function relocateEventFiles(client: SupabaseClient<Database>, paths: string[], restoring = false) {
  const bucket = client.storage.from('event-media');
  for (const path of paths) {
    const source = restoring ? `deleted/${path}` : path;
    const target = restoring ? path : `deleted/${path}`;
    const exists = await bucket.exists(source);
    if (exists.error) throw new Error('Event deletion cleanup failed');
    if (!exists.data) {
      const alreadyMoved = await bucket.exists(target);
      if (alreadyMoved.error) throw new Error('Event deletion cleanup failed');
      // An upload reservation may never have acquired a file; restore validates records.
      if (restoring && !alreadyMoved.data) throw new Error('Event restoration files missing');
      continue;
    }
    const moved = await bucket.move(source, target);
    if (moved.error) throw new Error('Event deletion cleanup failed');
  }
}