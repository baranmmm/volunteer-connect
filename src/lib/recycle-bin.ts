import { z } from 'zod';

export const recycleType = z.enum(['event', 'user', 'series', 'event_request', 'volunteer_application', 'branch', 'region']);
/** Rows the database deletes and restores by itself (no files, no Auth account). */
export const DATABASE_ONLY_TYPES = ['volunteer_application', 'branch', 'region'] as const;
export type RecycleType = z.infer<typeof recycleType>;
export const recycleItemInput = z.object({ type: recycleType, id: z.string().uuid() });
export const permanentDeleteInput = recycleItemInput.extend({ confirmation: z.literal('DELETE') });
export const recycleRow = z.object({
  id: z.string(), type: recycleType, title: z.string(), role: z.string().nullable(),
  branch: z.string().nullable(), region: z.string().nullable(), deleted_by_name: z.string().nullable(),
  deleted_at: z.string(), days_left: z.number(), can_restore: z.boolean(),
  self_requested: z.boolean().default(false), event_count: z.number().nullable().default(null), total_count: z.number(),
});
export type RecycleRow = z.infer<typeof recycleRow>;