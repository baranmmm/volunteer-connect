import { createHash, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { eventDeletionResult } from './event-deletion';

export const CLEANUP_EVENT_BATCH = 25;
export const CLEANUP_FILE_BATCH = 100;
export function cleanupAuthorized(header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

export async function cleanupDeletedEvents(client: SupabaseClient<Database>, now = new Date()) {
  const counts = { events: 0, files: 0 };
  const started = await client.from('event_cleanup_audit').insert({}).select('id').single();
  if (started.error) throw new Error('Cleanup unavailable');
  let failed = false;
  try {
    const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
    const result = await client.from('events').select('id').lt('deleted_at', cutoff).order('deleted_at').order('id').limit(CLEANUP_EVENT_BATCH);
    if (result.error) throw new Error('Cleanup unavailable');
    for (const event of result.data) {
      const prepared = await client.rpc('purge_event', { _event: event.id });
      // Concurrent restore or already-purged rows are safe to skip.
      if (prepared.error?.message === 'Event cannot be purged') continue;
      if (prepared.error) throw new Error('Cleanup unavailable');
      const { paths } = eventDeletionResult.parse(prepared.data);
      for (let offset = 0; offset < paths.length; offset += CLEANUP_FILE_BATCH) {
        const batch = paths.slice(offset, offset + CLEANUP_FILE_BATCH);
        const removed = await client.storage.from('event-media').remove(batch);
        if (removed.error) throw new Error('Cleanup unavailable');
        counts.files += batch.length;
      }
      const finalized = await client.rpc('purge_event', { _event: event.id, _finalize: true });
      if (finalized.error?.message === 'Event cannot be purged') continue;
      if (finalized.error || !eventDeletionResult.parse(finalized.data).deleted) throw new Error('Cleanup unavailable');
      counts.events++;
    }
  } catch { failed = true; }
  const audit = await client.from('event_cleanup_audit').update({ finished_at: new Date().toISOString(), events_purged: counts.events, files_purged: counts.files, outcome: failed ? 'failed' : 'completed' }).eq('id', started.data.id);
  return { counts, failed: failed || audit.error !== null };
}