import { z } from 'zod';

export const eventDeletionState = z.object({
  canManage: z.boolean(),
  canDelete: z.boolean(),
  pending: z.boolean(),
  reason: z.enum(['status', 'started', 'registrations']).nullable(),
});
export const eventDeletionResult = z.object({ paths: z.array(z.string()), deleted: z.boolean() });
