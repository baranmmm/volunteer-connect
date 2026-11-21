import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { eventDeletionResult } from './event-deletion';

export const deleteEvent = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), title: z.string().max(200).optional() }))
  .handler(async ({ data, context }) => {
    // Authorization and eligibility must precede privileged Storage access.
    const prepared = await context.supabase.rpc('delete_event', { _event: data.id, ...(data.title !== undefined ? { _title: data.title } : {}) });
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

export const listDeletedEvents = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ offset: z.number().int().min(0).max(1000000) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc('list_deleted_events', { _offset: data.offset });
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const restoreEvent = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
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