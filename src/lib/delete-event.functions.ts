import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireMember } from '@/lib/require-member';
import { eventDeletionResult } from './event-deletion';

export const deleteEvent = createServerFn({ method: 'POST' })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid(), title: z.string().max(200).optional() }))
  .handler(async ({ data, context }) => {
    // Authorization and eligibility must precede privileged Storage access.
    const prepared = await context.supabase.rpc('delete_event', { _event: data.id });
    if (prepared.error) throw new Error(prepared.error.message);
    const { paths } = eventDeletionResult.parse(prepared.data);
    if (paths.length) {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { relocateEventFiles } = await import('./event-storage.server');
      await relocateEventFiles(supabaseAdmin, paths);
    }
    const finalized = await context.supabase.rpc('delete_event', { _event: data.id, _complete: true });
    if (finalized.error) throw new Error(finalized.error.message);
    if (!eventDeletionResult.parse(finalized.data).deleted) throw new Error('Event deletion cleanup failed');
  });

/** Deletes 'following' (splits first) or 'all' occurrences into the Recycle Bin as one series item. */
export const deleteSeries = createServerFn({ method: 'POST' })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid(), mode: z.enum(['following', 'all']) }))
  .handler(async ({ data, context }) => {
    // Authorization precedes privileged Storage access.
    const prepared = await context.supabase.rpc('delete_series', { _event: data.id, _mode: data.mode });
    if (prepared.error) throw new Error(prepared.error.message);
    const { series_id, paths } = z.object({ series_id: z.string().uuid(), paths: z.array(z.string()) }).parse(prepared.data);
    if (paths.length) {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { relocateEventFiles } = await import('./event-storage.server');
      await relocateEventFiles(supabaseAdmin, paths);
    }
    const finished = await context.supabase.rpc('finish_series_deletion', { _series: series_id });
    if (finished.error) throw new Error(finished.error.message);
    return { seriesId: series_id };
  });

export const listDeletedEvents = createServerFn({ method: 'POST' })
  .middleware([requireMember])
  .inputValidator(z.object({ offset: z.number().int().min(0).max(1000000) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc('list_deleted_events', { _offset: data.offset });
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const restoreEvent = createServerFn({ method: 'POST' })
  .middleware([requireMember])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const prepared = await context.supabase.rpc('restore_event', { _event: data.id });
    if (prepared.error) throw new Error(prepared.error.message);
    const { paths } = eventDeletionResult.parse(prepared.data);
    if (paths.length) {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const { relocateEventFiles } = await import('./event-storage.server');
      await relocateEventFiles(supabaseAdmin, paths, true);
    }
    const result = await context.supabase.rpc('restore_event', { _event: data.id, _finalize: true });
    if (result.error) throw new Error(result.error.message);
  });