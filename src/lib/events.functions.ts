import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import type { EventMedia, HubEvent, EventRow, MediaRow } from './event-rules';
import { normalizeEventExtension } from './event-rules';
import { eventDeletionState } from './event-deletion';

async function active(client: SupabaseClient<Database>, uid: string) {
  const { data, error } = await client.from('profiles').select('status').eq('id', uid).single();
  if (error || data.status !== 'active') throw new Error('Not allowed');
}
async function withMedia(client: SupabaseClient<Database>, events: EventRow[]): Promise<HubEvent[]> {
  if (!events.length) return [];
  const media: MediaRow[] = [];
  for (let i = 0; i < events.length; i += 100) {
    const ids = events.slice(i, i + 100).map(e => e.id);
    const result = await client.from('event_media').select('*').in('event_id', ids).order('position').order('id');
    if (result.error) throw result.error;
    media.push(...result.data);
  }
  const signed: EventMedia[] = [];
  for (let i = 0; i < media.length; i += 100) {
    const batch = media.slice(i, i + 100);
    const urls = await client.storage.from('event-media').createSignedUrls(batch.map(m => m.storage_path), 300);
    if (urls.error) throw urls.error;
    for (const m of batch) {
      const raw = urls.data.find(u => u.path === m.storage_path)?.signedUrl;
      // Keep browser-facing URLs on the browser's Supabase origin, not a server-only endpoint.
      const url = raw ? `${import.meta.env['VITE_SUPABASE_URL']}${new URL(raw).pathname}${new URL(raw).search}` : null;
      signed.push({ ...m, url });
    }
  }
  return events.map(e => ({ ...e, media: signed.filter(m => m.event_id === e.id).sort((a,b) => a.position-b.position) }));
}
export const listEvents = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await active(context.supabase, context.userId);
  const events: EventRow[] = [];
  for (let offset = 0; ; offset += 200) {
    const result = await context.supabase.from('events').select('*').order('start_at').order('id').range(offset, offset + 199);
    if (result.error) throw result.error;
    events.push(...result.data);
    if (result.data.length < 200) break;
  }
  return withMedia(context.supabase, events);
});
export const getEvent = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ id: z.string().uuid() })).handler(async ({ data, context }) => {
  await active(context.supabase, context.userId);
  const result = await context.supabase.from('events').select('*').eq('id', data.id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const manage = await context.supabase.rpc('get_event_deletion_state', { _event: data.id });
  if (manage.error) throw manage.error;
  const deletion = eventDeletionState.parse(manage.data);
  const [branch, region] = await Promise.all([
    result.data.branch_id ? context.supabase.from('branches').select('name').eq('id', result.data.branch_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    context.supabase.from('regions').select('name').eq('id', result.data.region_id).maybeSingle(),
  ]);
  if (branch.error) throw branch.error;
  if (region.error) throw region.error;
  return { event: (await withMedia(context.supabase, [result.data]))[0] ?? null, canManage: deletion.canManage, deletion, branchName: branch.data?.name ?? null, regionName: region.data?.name ?? null };
});
export const eventBranches = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await active(context.supabase, context.userId);
  const roles = await context.supabase.from('user_roles').select('role,region_id').eq('user_id', context.userId);
  if (roles.error) throw roles.error;
  const director = roles.data.find(r => r.role === 'regional_director');
  let query = context.supabase.from('branches').select('id,name').order('name');
  if (director?.region_id) query = query.eq('region_id', director.region_id);
  else {
    if (!roles.data.some(r => r.role === 'branch_manager')) throw new Error('Not allowed');
    const profile = await context.supabase.from('profiles').select('branch_id').eq('id', context.userId).single();
    if (profile.error || !profile.data.branch_id) return [];
    query = query.eq('id', profile.data.branch_id);
  }
  const result = await query;
  if (result.error) throw result.error;
  return result.data;
});
const input = z.object({ title: z.string().trim().min(1).max(200), description: z.string(), location: z.string(), organizer: z.string().trim().min(1).max(200), category: z.enum(['dialogue','dinner','interfaith','community','education','other']), start_at: z.string().datetime(), end_at: z.string().datetime().nullable(), capacity: z.number().int().positive().nullable(), scope: z.enum(['branch','region']), branch_id: z.string().uuid().nullable(), status: z.enum(['draft','published','cancelled']) });
export const saveEvent = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ id: z.string().uuid().nullable(), event: input })).handler(async ({ data, context }) => {
  const result = data.id ? await context.supabase.rpc('update_event', { _event: data.id, _data: data.event }) : await context.supabase.rpc('create_event', { _data: data.event });
  if (result.error) throw new Error(result.error.message);
  return data.id ?? String(result.data);
});
export const cancelEvent = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ id: z.string().uuid() })).handler(async ({ data, context }) => {
  const result = await context.supabase.rpc('cancel_event', { _event: data.id });
  if (result.error) throw new Error(result.error.message);
});
export const reserveEventMedia = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ eventId: z.string().uuid(), kind: z.enum(['image','pdf']), extension: z.enum(['jpg','jpeg','png','webp','pdf']) })).handler(async ({ data, context }) => {
  const result = await context.supabase.rpc('add_event_media', { _event: data.eventId, _kind: data.kind, _extension: normalizeEventExtension(data.extension) });
  if (result.error) throw new Error(result.error.message);
  const row = await context.supabase.from('event_media').select('*').eq('id', result.data).single();
  if (row.error) throw row.error;
  return row.data;
});
export const reorderEventMedia = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ eventId: z.string().uuid(), ids: z.array(z.string().uuid()).max(5) })).handler(async ({ data, context }) => {
  const result = await context.supabase.rpc('reorder_event_media', { _event: data.eventId, _ids: data.ids });
  if (result.error) throw new Error(result.error.message);
});
export const deleteEventMedia = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ id: z.string().uuid() })).handler(async ({ data, context }) => {
  const result = await context.supabase.rpc('delete_event_media', { _media: data.id });
  if (result.error) throw new Error(result.error.message);
});
