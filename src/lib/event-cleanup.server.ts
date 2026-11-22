import { createHash, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { purgeEventRequest, purgeRecycleItem } from './recycle-bin.server';

export const CLEANUP_EVENT_BATCH = 25;
export const CLEANUP_FILE_BATCH = 100;
export function cleanupAuthorized(header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

export async function cleanupDeletedEvents(client: SupabaseClient<Database>, now = new Date()) {
  const counts = { events: 0, users: 0, files: 0, requests: 0 };
  const started = await client.from('event_cleanup_audit').insert({}).select('id').single();
  if (started.error) throw new Error('Cleanup unavailable');
  let failed = false;
  try {
    const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString();
    const result = await client.from('events').select('id').lt('deleted_at', cutoff).order('deleted_at').order('id').limit(CLEANUP_EVENT_BATCH);
    if (result.error) throw new Error('Cleanup unavailable');
    const users = await client.from('profiles').select('id').lt('deleted_at', cutoff).order('deleted_at').order('id').limit(CLEANUP_EVENT_BATCH);
    if (users.error) throw new Error('Cleanup unavailable');
    for (const item of [...result.data.map(e => ({ ...e, type: 'event' as const })), ...users.data.map(u => ({ ...u, type: 'user' as const }))]) {
      try {
        const purged = await purgeRecycleItem(client, item.type, item.id);
        counts.events += purged.events; counts.users += purged.users; counts.files += purged.files;
      } catch (e) {
        if (e instanceof Error && ['Event cannot be purged', 'Item cannot be purged'].includes(e.message)) continue;
        failed = true;
      }
    }
    // Series rows whose events have all been purged.
    const series = await client.rpc('purge_expired_series');
    if (series.error) failed = true;
    // Event requests past their 30 days: those with attachments one by one (Storage first), then the rest at once.
    const expiredRequests = await client.from('event_requests').select('id').lt('deleted_at', cutoff).order('deleted_at').order('id').limit(CLEANUP_EVENT_BATCH);
    if (expiredRequests.error) failed = true;
    for (const request of expiredRequests.data ?? []) {
      try {
        const purged = await purgeEventRequest(client, request.id);
        counts.requests += purged.requests; counts.files += purged.files;
      } catch { failed = true; }
    }
    const requests = await client.rpc('purge_expired_event_requests');
    if (requests.error) failed = true; else counts.requests += requests.data ?? 0;
  } catch { failed = true; }
  const audit = await client.from('event_cleanup_audit').update({ finished_at: new Date().toISOString(), events_purged: counts.events, users_purged: counts.users, files_purged: counts.files, requests_purged: counts.requests, outcome: failed ? 'failed' : 'completed' }).eq('id', started.data.id);
  return { counts, failed: failed || audit.error !== null };
}