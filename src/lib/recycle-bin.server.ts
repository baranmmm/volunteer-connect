import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { eventDeletionResult } from './event-deletion';
import type { RecycleType } from './recycle-bin';

/** Only call after the user-scoped prepare RPC, or from the secret-authenticated scheduler. */
export async function purgeRecycleItem(client: SupabaseClient<Database>, type: Exclude<RecycleType, 'series'>, id: string) {
  if (type === 'user') {
    const prepared = await client.rpc('prepare_user_purge', { _id: id });
    if (prepared.error) throw new Error(prepared.error.message);
    if (eventDeletionResult.parse(prepared.data).deleted) return { events: 0, users: 0, files: 0 };
    const removed = await client.auth.admin.deleteUser(id);
    if (removed.error && removed.error.code !== 'user_not_found') throw new Error('Account erasure failed');
    const finished = await client.rpc('finish_user_recycle_operation', { _id: id, _operation: 'purge' });
    if (finished.error) throw new Error(finished.error.message);
    return { events: 0, users: 1, files: 0 };
  }
  const prepared = await client.rpc('purge_event', { _event: id });
  if (prepared.error) throw new Error(prepared.error.message);
  const result = eventDeletionResult.parse(prepared.data);
  if (result.deleted) return { events: 0, users: 0, files: 0 };
  for (let offset = 0; offset < result.paths.length; offset += 100) {
    const removed = await client.storage.from('event-media').remove(result.paths.slice(offset, offset + 100));
    if (removed.error) throw new Error('Event deletion cleanup failed');
  }
  const finished = await client.rpc('purge_event', { _event: id, _finalize: true });
  if (finished.error || !eventDeletionResult.parse(finished.data).deleted) throw new Error('Event deletion cleanup failed');
  return { events: 1, users: 0, files: result.paths.length };
}