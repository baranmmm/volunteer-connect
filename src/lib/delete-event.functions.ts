import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { eventDeletionResult } from './event-deletion';

export const deleteEvent = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    // Authorization and eligibility must precede privileged Storage access.
    const prepared = await context.supabase.rpc('delete_event', { _event: data.id });
    if (prepared.error) throw new Error(prepared.error.message);
    const { paths } = eventDeletionResult.parse(prepared.data);
    if (paths.length) {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      try {
        for (let offset = 0; offset < paths.length; offset += 100) {
          const removed = await supabaseAdmin.storage.from('event-media').remove(paths.slice(offset, offset + 100));
          if (removed.error) throw removed.error;
        }
      } catch {
        // Keep the durable job and media rows, preventing uploads until retry.
        throw new Error('Event deletion cleanup failed');
      }
    }
    const finalized = await context.supabase.rpc('delete_event', { _event: data.id, _finalize: true });
    if (finalized.error) throw new Error(finalized.error.message);
    if (!eventDeletionResult.parse(finalized.data).deleted) throw new Error('Event deletion cleanup failed');
  });