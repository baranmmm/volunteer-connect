import { z } from "zod";
import type { TFunction } from "i18next";
import { eventEnd, eventStart, londonToIso, type EventTime } from "./event-rules";

export const REGISTRATION_STATUSES = [
  "registered",
  "waitlisted",
  "cancelled",
  "attended",
  "no_show",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export const REGISTRATION_NOTICES = [
  "promoted",
  "event_cancelled",
  "event_removed",
  "event_changed",
] as const;
export type RegistrationNotice = (typeof REGISTRATION_NOTICES)[number];

const status = z.enum(REGISTRATION_STATUSES);
/** get_event_registration_summary: counts are always present; names only when the viewer may see them. */
export const registrationSummary = z.object({
  capacity: z.number().int().nullable(),
  registration_enabled: z.boolean(),
  registered_count: z.number().int(),
  waitlisted_count: z.number().int(),
  spots_left: z.number().int().nullable(),
  over_capacity: z.boolean(),
  my_registration_id: z.string().uuid().nullable(),
  my_status: status.nullable(),
  my_show_name: z.boolean(),
  my_waitlist_position: z.number().int().nullable(),
  names_visible: z.boolean(),
  names: z.array(z.string()),
});
export type RegistrationSummary = z.infer<typeof registrationSummary>;
export const registrationResult = z.object({
  registration_id: z.string().uuid(),
  status,
  waitlist_position: z.number().int().nullable(),
});

export type ManagerRegistration = {
  id: string;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  status: RegistrationStatus;
  show_name: boolean;
  registered_at: string;
  cancelled_at: string | null;
  attendance_marked_at: string | null;
  attendance_marked_by_name: string | null;
  waitlist_position: number | null;
};
export type MyRegistration = {
  registration_id: string;
  event_id: string;
  title: string;
  all_day: boolean;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  event_status: string;
  event_removed: boolean;
  status: RegistrationStatus;
  waitlist_position: number | null;
  notice: RegistrationNotice | null;
};

/** "12 / 30 registered · 3 on waitlist", or "12 registered" when unlimited. */
export function registrationCountText(
  s: Pick<RegistrationSummary, "capacity" | "registered_count" | "waitlisted_count">,
  t: TFunction,
) {
  const registered =
    s.capacity === null
      ? t("registrations.countUnlimited", { count: s.registered_count })
      : t("registrations.countLimited", { count: s.registered_count, capacity: s.capacity });
  return s.waitlisted_count > 0
    ? `${registered} · ${t("registrations.waitlistCount", { count: s.waitlisted_count })}`
    : registered;
}

/** Calendar/list badge for the viewer's own registration. */
export function registrationBadge(
  status: RegistrationStatus | null | undefined,
): "registered" | "waitlisted" | null {
  return status === "registered" || status === "attended"
    ? "registered"
    : status === "waitlisted"
      ? "waitlisted"
      : null;
}

type EventForActions = EventTime & { status: string; registration_enabled: boolean };
/** Which registration control the detail page shows, or why none is shown. */
export function registrationAction(
  event: EventForActions,
  summary: Pick<RegistrationSummary, "my_status" | "capacity" | "registered_count">,
  now = new Date(),
):
  | { kind: "register" | "waitlist" | "cancel" }
  | { kind: "none"; reason: "cancelled" | "past" | "closed" | "started" | "attended" | "draft" } {
  const startIso = eventStart(event),
    endIso = eventEnd(event);
  const toInstant = (value: string | null, end: boolean) =>
    !value ? null : event.all_day ? londonDayBoundary(value, end) : Date.parse(value);
  const start = toInstant(startIso, false),
    end = toInstant(endIso, true);
  const mine = summary.my_status;
  if (mine === "attended" || mine === "no_show") return { kind: "none", reason: "attended" };
  if (event.status === "cancelled") return { kind: "none", reason: "cancelled" };
  if (event.status !== "published") return { kind: "none", reason: "draft" };
  if (end === null || end <= now.getTime()) return { kind: "none", reason: "past" };
  if (mine === "registered" || mine === "waitlisted")
    return start !== null && start <= now.getTime()
      ? { kind: "none", reason: "started" }
      : { kind: "cancel" };
  if (!event.registration_enabled) return { kind: "none", reason: "closed" };
  return summary.capacity !== null && summary.registered_count >= summary.capacity
    ? { kind: "waitlist" }
    : { kind: "register" };
}
/** Start (00:00) or end (next 00:00) of a London calendar day as an instant. */
function londonDayBoundary(date: string, end: boolean) {
  const day = end
    ? new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : date;
  return Date.parse(londonToIso(`${day}T00:00`));
}

const CSV_HEADER = ["name", "email", "status", "registered_at", "attendance"] as const;
function csvCell(value: string) {
  // Quote always; neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
/** CSV for managers: name, e-mail, status, registered_at, attendance. Never phone or other personal data. */
export function registrationsCsv(rows: ManagerRegistration[]) {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    const attendance = r.status === "attended" || r.status === "no_show" ? r.status : "";
    lines.push(
      [r.full_name ?? "", r.email ?? "", r.status, r.registered_at, attendance]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
