import { formatCreatedDate, type TaskSection } from "@/lib/task-grouping";
import type { TFunction } from "i18next";
import { dateLocale, formatDate } from "@/lib/i18n";
import type { WorkScope } from "@/lib/tasks";

/** A London calendar day (YYYY-MM-DD) as a short localized date; noon UTC so no time zone can shift the day. */
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return formatDate(`${day}T12:00:00Z`, opts);
}

/** "National", "Region: X" or "Branch: Y" for a task's scope. */
export function scopeText(
  t: TFunction,
  s: { scope: WorkScope; branch: string | null; region: string | null },
) {
  if (s.scope === "national") return t("work.scope.national");
  if (s.scope === "region") return t("work.scope.regionNamed", { name: s.region ?? "" });
  return t("work.scope.branchNamed", { name: s.branch ?? "" });
}

/** Up to two initials of a name ("Ayse Yilmaz" → "AY"); "?" when there is no name. */
export function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = Array.from(parts[0]!)[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

export const selectClass =
  "h-11 w-full min-w-0 max-w-full rounded-xl border border-input bg-card px-3 text-base";

/** The header text of a section: "<title> (<date>)" for a meeting or event, a due bucket, a name or a title. */
export function sectionLabel(t: TFunction, s: TaskSection) {
  const day = s.date ? formatDay(s.date) : null;
  if (s.kind === "meeting" || s.kind === "event") return `${s.title}${day ? ` (${day})` : ""}`;
  if (s.kind === "due") return t(`tasks.grouping.due.${s.title}`);
  return s.title;
}

/** "25 Nov" (this year) or "25 Nov 2025" (another year) for a task's created_at, in the current language. */
export function createdDay(createdAt: string, today: string) {
  return formatCreatedDate(createdAt, today, dateLocale());
}
