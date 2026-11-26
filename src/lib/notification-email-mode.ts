import type {
  NotificationSettings,
  NotificationSetting,
  NotificationType,
} from "@/lib/notifications";
import { NOTIFICATION_TYPES } from "@/lib/notifications";

// Profile > Notifications, the simple Email choice. It is only a shortcut over the per-type email switches
// (set_notification_email): choosing one writes every type's email, and the choice shown is derived from the stored
// per-type values (a mix that matches none of the three is "custom", shown but never selectable).

/** Emails that matter at once: assignments (incl. task groups), mentions, requests to review, meetings, reminders. */
export const IMPORTANT_EMAIL_TYPES: readonly NotificationType[] = [
  "task_assigned",
  "mention",
  "review",
  "meeting",
  "task_reminder",
];

export const EMAIL_MODES = ["all", "important", "none"] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];
export type EmailModeState = EmailMode | "custom";

/** Whether a type's email is on under a mode. */
export function emailOnFor(mode: EmailMode, type: NotificationType): boolean {
  if (mode === "all") return true;
  if (mode === "none") return false;
  return IMPORTANT_EMAIL_TYPES.includes(type);
}

/**
 * The mode the stored values match. It reads the stored email switch of every type (also of a type turned off in the
 * app, which sends nothing either way), so choosing a mode always shows that mode afterwards.
 */
export function emailModeOf(types: Pick<NotificationSetting, "type" | "email">[]): EmailModeState {
  if (types.length === 0) return "custom";
  return (
    EMAIL_MODES.find((mode) => types.every((s) => s.email === emailOnFor(mode, s.type))) ?? "custom"
  );
}

/** The email switches a mode changes (only those that differ from the stored value). */
export function emailModeChanges(
  types: Pick<NotificationSetting, "type" | "email">[],
  mode: EmailMode,
): { type: NotificationType; on: boolean }[] {
  return types
    .filter((s) => (NOTIFICATION_TYPES as readonly string[]).includes(s.type))
    .filter((s) => s.email !== emailOnFor(mode, s.type))
    .map((s) => ({ type: s.type, on: emailOnFor(mode, s.type) }));
}

/** The settings after a change (for the optimistic cache update); task reminder emails follow the type's switch. */
export function withTypeChange(
  settings: NotificationSettings,
  type: NotificationType,
  next: Partial<Pick<NotificationSetting, "enabled" | "email" | "push">>,
): NotificationSettings {
  const types = settings.types.map((s) => (s.type === type ? { ...s, ...next } : s));
  return {
    task_reminder_emails:
      types.find((s) => s.type === "task_reminder")?.email ?? settings.task_reminder_emails,
    types,
  };
}

/** The settings after choosing a mode. */
export function withEmailMode(
  settings: NotificationSettings,
  mode: EmailMode,
): NotificationSettings {
  return emailModeChanges(settings.types, mode).reduce(
    (acc, change) => withTypeChange(acc, change.type, { email: change.on }),
    settings,
  );
}
