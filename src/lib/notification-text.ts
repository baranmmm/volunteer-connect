import type { TFunction } from "i18next";
import { currentLang, formatDate, type Lang } from "@/lib/i18n";
import { notificationKey, type Notification } from "@/lib/notifications";
import type { NoticeEntry } from "@/lib/notification-groups";

/** "Medway", "Medway and Brighton", "Medway, Brighton and Hastings" (Turkish: "… ve …"). */
export function branchList(names: string[], lang: Lang = currentLang()) {
  return new Intl.ListFormat(lang === "tr" ? "tr" : "en-GB", {
    style: "long",
    type: "conjunction",
  }).format(names);
}

/** The text of a notice (texts come from the kind and stored fields, never stored sentences). */
export function notificationText(n: Notification, t: TFunction, lang: Lang = currentLang()) {
  const p = n.payload;
  if (n.kind === "review_waiting") {
    const branches = p.branches ?? [];
    const key =
      branches.length === 0
        ? "notifications.kinds.review_waiting"
        : branches.length === 1
          ? "notifications.kinds.review_waiting_branch"
          : "notifications.kinds.review_waiting_branches";
    return t(key, { count: p.total ?? 0, branches: branchList(branches, lang) });
  }
  if (n.kind === "daily_digest")
    return t("notifications.kinds.daily_digest", { count: p.count ?? 0 });
  // Several notes on one task while unread: one updating notice.
  if (n.kind === "task_note_added" && (p.count ?? 1) > 1)
    return t("notifications.kinds.task_note_added_many", { count: p.count, title: n.title });
  const key =
    n.kind === "task_reminder" && p.reminder === "overdue"
      ? "notifications.kinds.task_reminder_overdue"
      : n.kind === "volunteer_application_approved" && p.role === "trustee"
        ? "notifications.kinds.volunteer_application_approved_trustee"
        : notificationKey(n.kind);
  return t(key, {
    actor: n.actor_name || t("notifications.someone"),
    title: n.title,
    reason: p.reason ?? "",
    branch: p.branch ?? n.title,
    status: p.status ? t(`notifications.taskStatus.${p.status}`, { defaultValue: p.status }) : "",
    due: p.due_date ? formatDate(`${p.due_date}T12:00:00Z`, { dateStyle: "medium" }) : "",
    when: p.starts_at ? formatDate(p.starts_at, { dateStyle: "medium", timeStyle: "short" }) : "",
  });
}

const GROUP_KINDS = new Set([
  "task_assigned",
  "task_status_changed",
  "task_reminder",
  "task_note_mention",
  "task_note_added",
  "meeting_invited",
  "meeting_changed",
  "meeting_cancelled",
  "task_request_accepted",
  "task_request_declined",
  "meeting_request_approved",
  "meeting_request_declined",
]);
/** Kinds whose group line names the branch ("4 tasks in Medway were completed"). */
const BRANCH_KINDS = new Set([
  "task_assigned",
  "task_status_changed",
  "task_reminder",
  "task_note_mention",
  "task_note_added",
  "meeting_invited",
  "meeting_changed",
  "meeting_cancelled",
]);

/** The line of a group of similar notices. */
export function groupText(entry: Extract<NoticeEntry, { type: "group" }>, t: TFunction) {
  const count = entry.items.length;
  if (!GROUP_KINDS.has(entry.kind)) return t("notifications.groups.other", { count });
  let key = entry.kind;
  if (
    entry.kind === "task_status_changed" &&
    (entry.status === "done" || entry.status === "blocked")
  )
    key += `_${entry.status}`;
  if (entry.branch && BRANCH_KINDS.has(entry.kind)) key += "_branch";
  return t(`notifications.groups.${key}`, {
    count,
    branch: entry.branch ?? "",
    status: entry.status
      ? t(`notifications.taskStatus.${entry.status}`, { defaultValue: entry.status })
      : "",
  });
}
