import { z } from 'zod';

export const eventDeletionState = z.object({
  canManage: z.boolean(),
  canDelete: z.boolean(),
  pending: z.boolean(),
  reason: z.enum(['status', 'started', 'registrations']).nullable(),
});
export const eventDeletionResult = z.object({ paths: z.array(z.string()), deleted: z.boolean() });

export function requiresEventTitle(event: { status: string; start_at: string | null }, now = Date.now()) {
  return event.status !== 'draft' || (event.start_at !== null && Date.parse(event.start_at) <= now);
}