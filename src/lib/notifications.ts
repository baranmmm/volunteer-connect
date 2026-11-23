import { z } from "zod";

// In-app notices. Texts are rendered from the kind and the stored title (i18n keys notifications.kinds.*), never from
// stored sentences.
export const NOTIFICATION_KINDS = [
  "task_assigned",
  "task_status_changed",
  "task_reminder",
  "task_note_mention",
  "task_note_added",
  "task_request_received",
  "task_request_accepted",
  "task_request_declined",
  "meeting_invited",
  "meeting_changed",
  "meeting_cancelled",
  "meeting_request_received",
  "meeting_request_approved",
  "meeting_request_declined",
] as const;

export const notification = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  entity_type: z.enum(["task", "meeting", "task_request", "meeting_request"]),
  entity_id: z.string().uuid(),
  title: z.string(),
  link: z.string().startsWith("/"),
  payload: z.object({
    reason: z.string().optional(),
    status: z.string().optional(),
    previous: z.string().optional(),
    reminder: z.string().optional(),
    due_date: z.string().nullable().optional(),
    starts_at: z.string().optional(),
  }),
  created_at: z.string(),
  read_at: z.string().nullable(),
  actor_name: z.string().nullable(),
});
export type Notification = z.infer<typeof notification>;

export const notificationCounts = z.object({
  tasks: z.number(),
  requests: z.number(),
  meetings: z.number(),
  total: z.number(),
});
export type NotificationCounts = z.infer<typeof notificationCounts>;

/** The i18n key of a notice (unknown kinds fall back to a generic text). */
export function notificationKey(kind: string) {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind)
    ? `notifications.kinds.${kind}`
    : "notifications.kinds.other";
}
