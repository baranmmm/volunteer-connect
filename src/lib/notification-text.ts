import type { TFunction } from "i18next";
import { formatDate } from "@/lib/i18n";
import { notificationKey, type Notification } from "@/lib/notifications";

/** The i18n key and values of a notice (texts come from the kind and stored fields, never stored sentences). */
export function notificationText(n: Notification, t: TFunction) {
  const p = n.payload;
  const key =
    n.kind === "task_reminder" && p.reminder === "overdue"
      ? "notifications.kinds.task_reminder_overdue"
      : notificationKey(n.kind);
  return t(key, {
    actor: n.actor_name || t("notifications.someone"),
    title: n.title,
    reason: p.reason ?? "",
    status: p.status ? t(`notifications.taskStatus.${p.status}`, { defaultValue: p.status }) : "",
    due: p.due_date ? formatDate(`${p.due_date}T12:00:00Z`, { dateStyle: "medium" }) : "",
    when: p.starts_at ? formatDate(p.starts_at, { dateStyle: "medium", timeStyle: "short" }) : "",
  });
}
