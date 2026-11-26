import { z } from "zod";

// In-app notices. Texts are rendered from the kind and the stored title (i18n keys notifications.kinds.*), never from
// stored sentences.
export const NOTIFICATION_KINDS = [
  "task_assigned",
  "task_group_created",
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
  "review_waiting",
  "daily_digest",
  "email_budget_warning",
  "volunteer_application_approved",
  "volunteer_application_declined",
] as const;

export const notification = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  entity_type: z.enum([
    "task",
    "meeting",
    "task_request",
    "meeting_request",
    "review",
    "digest",
    "volunteer_application",
    "email_budget",
  ]),
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
    /** Branch of the task or meeting (grouping: "4 tasks in Medway were completed"). */
    branch: z.string().optional(),
    note_id: z.string().optional(),
    /** review_waiting: what waits for the reviewer (updated in place). */
    total: z.number().optional(),
    work: z.number().optional(),
    event_requests: z.number().optional(),
    applications: z.number().optional(),
    branches: z.array(z.string()).optional(),
    /** daily_digest: how many notices of each kind it holds. */
    count: z.number().optional(),
    kinds: z.record(z.string(), z.number()).optional(),
    day: z.string().optional(),
    /** email_budget_warning: emails sent today and the provider's daily limit. */
    sent: z.number().optional(),
    limit: z.number().optional(),
  }),
  created_at: z.string(),
  read_at: z.string().nullable(),
  actor_name: z.string().nullable(),
  /** Set on notices that came with a daily summary: the summary notice they belong to. */
  digest_id: z.string().uuid().nullable().optional(),
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

// ---------------------------------------------------------------------------------------------------------------
// Settings (Profile > Notifications). Direct assignments, mentions and requests waiting for review are always on and
// immediate ("locked"); the others can be turned off or delivered in the daily summary (08:00 London).

export const NOTIFICATION_TYPES = [
  "task_assigned",
  "mention",
  "review",
  "task_status",
  "task_note",
  "task_reminder",
  "meeting",
  "request_decided",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
/** How a type's email arrives: at once, in the daily summary, or both (meetings: invitations at once). */
export const NOTIFICATION_EMAIL_TIMINGS = ["immediate", "digest", "mixed"] as const;
export type NotificationEmailTiming = (typeof NOTIFICATION_EMAIL_TIMINGS)[number];
export const notificationSetting = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  /** In the app (always true for locked types). */
  enabled: z.boolean(),
  /** Email on/off (any type, locked ones included). */
  email: z.boolean(),
  locked: z.boolean(),
  email_timing: z.enum(NOTIFICATION_EMAIL_TIMINGS),
});
export type NotificationSetting = z.infer<typeof notificationSetting>;
export const notificationSettings = z.object({
  task_reminder_emails: z.boolean(),
  types: z.array(notificationSetting),
});
export type NotificationSettings = z.infer<typeof notificationSettings>;

/** What waits for the caller's decision (Requests badge, mobile More badge, dashboard "Waiting for you"). */
export const reviewWaiting = z.object({
  work: z.number(),
  event_requests: z.number(),
  applications: z.number(),
  total: z.number(),
  branches: z.array(z.string()),
});
export type ReviewWaiting = z.infer<typeof reviewWaiting>;
