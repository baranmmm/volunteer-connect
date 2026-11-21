import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { recycleItemInput, permanentDeleteInput, recycleRow } from './recycle-bin';
import { eventDeletionResult } from './event-deletion';

export const listRecycleBin = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ type: z.enum(['all', 'event', 'user']), search: z.string().max(200), offset: z.number().int().min(0).max(1000000) }))
  .handler(async ({ data, context }) => {
    const result = await context.supabase.rpc('list_recycle_bin', { _type: data.type, _search: data.search, _offset: data.offset });
    if (result.error) throw new Error(result.error.message);
    return z.array(recycleRow).parse(result.data);
  });

export const restoreRecycleItem = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(recycleItemInput)
  .handler(async ({ data, context }) => {
    const prepared = await context.supabase.rpc('restore_item', { _type: data.type, _id: data.id });
    if (prepared.error) throw new Error(prepared.error.message);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    if (data.type === 'event') {
      const { relocateEventFiles } = await import('./event-storage.server');
      await relocateEventFiles(supabaseAdmin, eventDeletionResult.parse(prepared.data).paths, true);
      const finished = await context.supabase.rpc('restore_event', { _event: data.id, _finalize: true });
      if (finished.error) throw new Error(finished.error.message);
    } else {
      // Unban first; until finalization, RLS still denies all personal data and app permissions.
      const unbanned = await supabaseAdmin.auth.admin.updateUserById(data.id, { ban_duration: 'none' });
      if (unbanned.error) throw new Error('Account restoration failed');
      const finished = await supabaseAdmin.rpc('finish_user_recycle_operation', { _id: data.id, _operation: 'restore' });
      if (finished.error) throw new Error(finished.error.message);
    }
    return { ok: true };
  });

export const permanentlyDeleteRecycleItem = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(permanentDeleteInput)
  .handler(async ({ data, context }) => {
    const prepared = await context.supabase.rpc('permanent_delete_item', { _type: data.type, _id: data.id, _confirmation: data.confirmation });
    if (prepared.error) throw new Error(prepared.error.message);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { purgeRecycleItem } = await import('./recycle-bin.server');
    await purgeRecycleItem(supabaseAdmin, data.type, data.id);
    return { ok: true };
  });