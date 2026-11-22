import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import type { EventMedia, HubEvent, EventRow, MediaRow } from './event-rules';
import { normalizeEventExtension } from './event-rules';
import { eventDeletionState } from './event-deletion';
import type { SeriesInfo } from './recurrence';

async function active(client: SupabaseClient<Database>, uid: string) {
  const { data, error } = await client.from('profiles').select('status').eq('id', uid).single();
  if (error || data.status !== 'active') throw new Error('Not allowed');
}
async function withMedia(client: SupabaseClient<Database>, events: EventRow[]): Promise<HubEvent[]> {
  if (!events.length) return [];
  // Occurrences of a series show the series' files, held by its media holder event (RLS: can_view_event_media).
  const seriesIds = [...new Set(events.flatMap(e => e.series_id ? [e.series_id] : []))];
  const holderOf = new Map<string, string>();
  for (let i = 0; i < seriesIds.length; i += 100) {
    const result = await client.from('event_series').select('id, media_event_id').in('id', seriesIds.slice(i, i + 100));
    if (result.error) throw result.error;
    for (const s of result.data) if (s.media_event_id) holderOf.set(s.id, s.media_event_id);
  }
  const ownerOf = (e: EventRow) => (e.series_id && holderOf.get(e.series_id)) || e.id;
  const owners = [...new Set(events.map(ownerOf))];
  const media: MediaRow[] = [];
  for (let i = 0; i < owners.length; i += 100) {
    const ids = owners.slice(i, i + 100);
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
  return events.map(e => ({ ...e, media: signed.filter(m => m.event_id === ownerOf(e)).sort((a,b) => a.position-b.position) }));
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
  // Series details (rule, EXDATEs); opening also extends the series' 12-month horizon.
  let series: SeriesInfo | null = null;
  if (result.data.series_id) {
    const opened = await context.supabase.rpc('open_series', { _series: result.data.series_id });
    if (!opened.error) series = seriesInfo.parse(opened.data);
  }
  return { event: (await withMedia(context.supabase, [result.data]))[0] ?? null, canManage: deletion.canManage, deletion, branchName: branch.data?.name ?? null, regionName: region.data?.name ?? null, series };
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
const seriesInfo = z.object({ id: z.string().uuid(), rule: z.string(), timezone: z.string(), all_day: z.boolean(), dtstart_local: z.string(), duration_minutes: z.number().nullable(), span_days: z.number(), status: z.string(), media_event_id: z.string().uuid().nullable(), exdates: z.array(z.string()) });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const input = z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(10000), location: z.string().max(500), location_type: z.enum(['in_person','online']), online_url: z.string().trim().max(2000).nullable(), organizer: z.string().trim().max(200), category: z.enum(['dialogue','dinner','interfaith','community','education','other']), all_day: z.boolean(), start_date: dateOnly.nullable(), end_date: dateOnly.nullable(), start_at: z.string().datetime().nullable(), end_at: z.string().datetime().nullable(), capacity: z.number().int().positive().nullable(), scope: z.enum(['branch','region']), branch_id: z.string().uuid().nullable(), status: z.enum(['draft','published','cancelled']) }).superRefine((event, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (event.online_url && !/^https:\/\/[^\s/?#]+\.[^\s]*$/.test(event.online_url)) issue('online_url', 'Online meeting link must use https');
  if (!event.all_day && event.start_at && event.end_at && Date.parse(event.end_at) <= Date.parse(event.start_at)) issue('end_at', 'Event end must be after start');
  if (event.all_day && event.start_date && event.end_date && event.end_date < event.start_date) issue('end_date', 'Event end must be after start');
  if (event.status !== 'draft') {
    if (event.all_day ? !event.start_date : !event.start_at || !event.end_at) issue('start_at', 'Required publish fields missing');
    if (event.location_type === 'in_person' ? !event.location.trim() : !event.online_url) issue('location', 'Required publish fields missing');
    if (event.scope === 'branch' && !event.branch_id) issue('branch_id', 'Required publish fields missing');
  }
});
export const saveEvent = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ id: z.string().uuid().nullable(), event: input })).handler(async ({ data, context }) => {
  const result = data.id ? await context.supabase.rpc('update_event', { _event: data.id, _data: data.event }) : await context.supabase.rpc('create_event', { _data: data.event });
  if (result.error) throw new Error(result.error.message);
  return data.id ?? String(result.data);
});
const rrule = z.string().trim().min(10).max(500).regex(/^FREQ=[A-Z0-9=;,+-]+$/);
const seriesResult = z.object({ series_id: z.string().uuid(), event_id: z.string().uuid(), media_event_id: z.string().uuid().nullable().optional() });
/** Creates a series and its first occurrences (at most 100, 12 months ahead); returns the first occurrence. */
export const createSeries = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ event: input, rule: rrule })).handler(async ({ data, context }) => {
  const result = await context.supabase.rpc('create_series', { _data: data.event, _rule: data.rule });
  if (result.error) throw new Error(result.error.message);
  const parsed = seriesResult.parse(result.data);
  return { seriesId: parsed.series_id, eventId: parsed.event_id, mediaEventId: parsed.media_event_id ?? null };
});
/** Edits one occurrence ('this'), this and the following ones ('following') or the whole series ('all'). */
export const updateSeriesEvent = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ id: z.string().uuid(), mode: z.enum(['this', 'following', 'all']), event: input, rule: rrule.nullable() })).handler(async ({ data, context }) => {
  const result = await context.supabase.rpc('update_series_event', { _event: data.id, _mode: data.mode, _data: data.event, ...(data.rule ? { _rule: data.rule } : {}) });
  if (result.error) throw new Error(result.error.message);
  const parsed = seriesResult.parse(result.data);
  return { seriesId: parsed.series_id, eventId: parsed.event_id };
});
export const cancelEvent = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ id: z.string().uuid() })).handler(async ({ data, context }) => {
  const result = await context.supabase.rpc('cancel_event', { _event: data.id });
  if (result.error) throw new Error(result.error.message);
});
export const reserveEventMedia = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ eventId: z.string().uuid(), kind: z.enum(['image','pdf','document']), extension: z.enum(['jpg','jpeg','png','webp','pdf','docx','pptx']), originalName: z.string().max(255).optional() })).handler(async ({ data, context }) => {
  const result = await context.supabase.rpc('add_event_media', { _event: data.eventId, _kind: data.kind, _extension: normalizeEventExtension(data.extension), _original_name: data.originalName ?? '' });
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
