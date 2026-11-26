import { formatInTimeZone } from "date-fns-tz";
import { LONDON, londonInput, londonToIso } from "@/lib/london-time";
import type { Database } from "@/integrations/supabase/types";
import { googleRecur, LONDON_VTIMEZONE, seriesIcsLines, type SeriesInfo } from "@/lib/recurrence";

export const EVENT_CATEGORIES = [
  "dialogue",
  "dinner",
  "interfaith",
  "community",
  "education",
  "other",
] as const;
/** Calendar categories: the event categories plus 'meeting' (a meeting's calendar entry, created with the meeting). */
export const MEETING_CATEGORY = "meeting" as const;
export const CALENDAR_CATEGORIES = [...EVENT_CATEGORIES, MEETING_CATEGORY] as const;
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];
/** A meeting's calendar entry: no registration, never public; edited, cancelled and deleted through its meeting. */
export const isMeetingEvent = (e: { category: string }) => e.category === MEETING_CATEGORY;
export const MAX_EVENT_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 2000;
export function normalizeEventExtension(extension: string) {
  const lower = extension.toLowerCase();
  return lower === "jpeg" ? "jpg" : lower;
}
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const EVENT_FILE_MIMES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: DOCX_MIME,
  pptx: PPTX_MIME,
};
export const EVENT_FILE_ACCEPT = `${Object.values(EVENT_FILE_MIMES).join(",")},.docx,.pptx`;
export type EventFileKind = "image" | "pdf" | "document";
/** Prefer the MIME type; browsers often leave Office types empty, so fall back to the exact file extension. */
export function eventFileExtension(type: string, name = "") {
  const byType = Object.entries(EVENT_FILE_MIMES).find(([, mime]) => mime === type)?.[0];
  if (byType) return byType;
  const ext = normalizeEventExtension(name.split(".").pop() ?? "");
  if (!type && (ext === "docx" || ext === "pptx")) return ext;
  return normalizeEventExtension(type.split("/")[1] ?? "");
}
export function eventFileKind(extension: string): EventFileKind | null {
  if (["jpg", "png", "webp"].includes(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "docx" || extension === "pptx") return "document";
  return null;
}
/** Storage errors use structured codes; older Storage versions only return messages. */
export function eventUploadError(error: unknown): Error {
  const value = error && typeof error === "object" ? error : {};
  const message = "message" in value ? String(value.message) : "";
  const code = "code" in value ? String(value.code) : "";
  if (
    code === "EntityTooLarge" ||
    /maximum allowed size|exceed.*size|too large|payload too large/i.test(message)
  )
    return new Error("Event file exceeds 10 MB");
  if (
    code === "InvalidMimeType" ||
    /mime.*not supported|unsupported.*mime|mime.*not allowed|invalid.*mime/i.test(message)
  )
    return new Error("Invalid event file");
  return new Error("Event file upload failed");
}
export type EventRow = Database["public"]["Tables"]["events"]["Row"];
export type MediaRow = Database["public"]["Tables"]["event_media"]["Row"];
export type EventMedia = MediaRow & { url: string | null };
/** `my_registration`: the viewer's own registration status (set by listEvents only). */
export type HubEvent = EventRow & {
  media: EventMedia[];
  my_registration?: "registered" | "waitlisted" | "cancelled" | "attended" | "no_show" | null;
};
export type EventInput = {
  title: string;
  description: string;
  location: string;
  location_type: "in_person" | "online";
  online_url: string | null;
  organizer: string;
  category: string;
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  start_at: string | null;
  end_at: string | null;
  scope: string;
  branch_id: string | null;
  capacity: number | null;
  status: string;
};
// London wall-clock helpers live in a leaf module (recurrence.ts needs them too, without importing this file back).
export { LONDON, londonInput, londonToIso };
export function imageDimensions(width: number, height: number) {
  const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
export function validateEventFile(
  file: { type: string; size: number; name?: string },
  count: number,
) {
  if (count >= MAX_EVENT_FILES) throw new Error("Maximum 5 files per event");
  const ext = eventFileExtension(file.type, file.name);
  const kind = eventFileKind(ext),
    nameExt = normalizeEventExtension(file.name?.split(".").pop() ?? "");
  // MIME and extension must agree for documents, so .doc/.docm/.ppt/.pptm or renamed files are rejected.
  if (
    !kind ||
    (file.type && EVENT_FILE_MIMES[ext] !== file.type) ||
    (kind === "document" && nameExt !== ext)
  )
    throw new Error("Invalid event file");
  if (file.size > MAX_FILE_BYTES) throw new Error("Event file exceeds 10 MB");
}
export type EventTime = {
  start_at: string | null;
  end_at: string | null;
  all_day?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
};
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export function londonDate(value: string | Date) {
  // Date-only values are calendar dates, not UTC midnight instants.
  return typeof value === "string" && DATE_ONLY.test(value)
    ? value
    : formatInTimeZone(value, LONDON, "yyyy-MM-dd");
}
export function eventStart(event: EventTime) {
  return event.all_day ? (event.start_date ?? null) : event.start_at;
}
export function eventEnd(event: EventTime) {
  return event.all_day ? (event.end_date ?? event.start_date ?? null) : event.end_at;
}
export function isScheduled(event: EventTime) {
  return !!eventStart(event);
}
function isDateOnly(event: EventTime) {
  const start = eventStart(event);
  return !!event.all_day || (!!start && DATE_ONLY.test(start));
}
export function eventTimeState(event: EventTime, now = new Date()) {
  const startValue = eventStart(event);
  if (!startValue) return { past: false, happeningNow: false };
  const endValue = eventEnd(event) ?? startValue;
  if (isDateOnly(event)) {
    const today = londonDate(now),
      start = londonDate(startValue),
      end = londonDate(endValue);
    return { past: end < today, happeningNow: start <= today && today <= end };
  }
  const start = Date.parse(startValue),
    end = Date.parse(endValue),
    current = now.getTime();
  return { past: end < current, happeningNow: start <= current && current <= end };
}
export function eventOccursOn(event: EventTime, day: string) {
  const start = eventStart(event);
  if (!start) return false;
  return londonDate(start) <= day && day <= londonDate(eventEnd(event) ?? start);
}
function sortKey(event: EventTime) {
  const start = eventStart(event);
  return start
    ? DATE_ONLY.test(start)
      ? Date.parse(`${start}T00:00:00Z`)
      : Date.parse(start)
    : Date.parse("9999-01-01");
}
export function filterEvents(
  events: HubEvent[],
  past: boolean | null,
  category: string,
  organizer: string,
  now = new Date(),
) {
  return events
    .filter(
      (e) =>
        (past === null || eventTimeState(e, now).past === past) &&
        (category === "all" || e.category === category) &&
        (organizer === "all" || e.organizer === organizer),
    )
    .sort((a, b) => (past ? -1 : 1) * (sortKey(a) - sortKey(b)) || a.id.localeCompare(b.id));
}
/** Display parts: same-day timed events do not repeat the date; all-day events return no time. */
export function eventWhen(event: EventTime, locale: string) {
  const start = eventStart(event);
  if (!start) return null;
  const end = eventEnd(event);
  const fmt = (v: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: LONDON, ...o }).format(
      new Date(DATE_ONLY.test(v) ? `${v}T12:00:00Z` : v),
    );
  const full = { weekday: "long", day: "numeric", month: "long", year: "numeric" } as const,
    time = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  if (isDateOnly(event))
    return {
      allDay: true,
      text:
        end && londonDate(end) !== londonDate(start)
          ? `${fmt(start, full)} – ${fmt(end, full)}`
          : fmt(start, full),
    };
  if (!end) return { allDay: false, text: `${fmt(start, full)}, ${fmt(start, time)}` };
  if (londonDate(start) === londonDate(end))
    return { allDay: false, text: `${fmt(start, full)}, ${fmt(start, time)} – ${fmt(end, time)}` };
  return {
    allDay: false,
    text: `${fmt(start, full)}, ${fmt(start, time)} – ${fmt(end, full)}, ${fmt(end, time)}`,
  };
}
function nextDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
type CalendarEvent = EventTime & {
  id: string;
  title: string;
  description: string;
  location: string;
  location_type?: string | null;
  online_url?: string | null;
  status: string;
};
function calendarDetails(event: CalendarEvent, url: string) {
  return [
    event.description.trim(),
    event.location_type === "online" && event.online_url ? event.online_url : "",
    url,
  ]
    .filter(Boolean)
    .join("\n\n");
}
function calendarLocation(event: CalendarEvent) {
  return event.location_type === "online" ? (event.online_url ?? "") : event.location;
}
function londonStamp(value: string) {
  return formatInTimeZone(value, LONDON, "yyyyMMdd'T'HHmmss");
}
/** With `series`, the link adds the whole series (recur=RRULE:…) from its first occurrence. */
export function googleCalendarUrl(event: CalendarEvent, url: string, series?: SeriesInfo | null) {
  const start = eventStart(event);
  if (!start) throw new Error("Required publish fields missing");
  if (series) {
    const ics = seriesIcsLines(series);
    const value = (prefix: string) =>
      (ics.find((l) => l.startsWith(prefix)) ?? "").split(":").pop() ?? "";
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: event.title,
      dates: `${value("DTSTART")}/${value("DTEND")}`,
      details: calendarDetails(event, url),
      location: calendarLocation(event),
      recur: googleRecur(series),
    });
    if (!series.all_day) params.set("ctz", LONDON);
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }
  const dates = isDateOnly(event)
    ? `${start.replace(/-/g, "")}/${nextDay(londonDate(eventEnd(event) ?? start)).replace(/-/g, "")}`
    : `${londonStamp(start)}/${londonStamp(eventEnd(event) ?? start)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates,
    details: calendarDetails(event, url),
    location: calendarLocation(event),
  });
  if (!isDateOnly(event)) params.set("ctz", LONDON);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
export function outlookCalendarUrl(event: CalendarEvent, url: string, work = false) {
  const start = eventStart(event);
  if (!start) throw new Error("Required publish fields missing");
  const allDay = isDateOnly(event);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    body: calendarDetails(event, url),
    location: calendarLocation(event),
    startdt: allDay ? start : new Date(start).toISOString(),
    enddt: allDay
      ? nextDay(londonDate(eventEnd(event) ?? start))
      : new Date(eventEnd(event) ?? start).toISOString(),
  });
  if (allDay) params.set("allday", "true");
  return `https://${work ? "outlook.office.com" : "outlook.live.com"}/calendar/0/deeplink/compose?${params.toString()}`;
}
function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function utcStamp(value: string | Date) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
function foldLine(line: string) {
  let result = "",
    bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) {
      result += "\r\n ";
      bytes = 1;
    }
    result += char;
    bytes += size;
  }
  return result;
}
/** With `series`, exports the whole series: London time zone, RRULE and EXDATE for deleted occurrences. */
export function eventIcs(
  event: CalendarEvent,
  url: string,
  now = new Date(),
  series?: SeriesInfo | null,
) {
  const start = eventStart(event);
  if (!start) throw new Error("Required publish fields missing");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dialogue Society//Volunteer Hub//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (series && !series.all_day) lines.push(...LONDON_VTIMEZONE);
  lines.push(
    "BEGIN:VEVENT",
    `UID:${series ? `series-${series.id}` : event.id}@dialoguesociety.org`,
    `DTSTAMP:${utcStamp(now)}`,
  );
  if (series) lines.push(...seriesIcsLines(series));
  else if (isDateOnly(event))
    lines.push(
      `DTSTART;VALUE=DATE:${start.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${nextDay(londonDate(eventEnd(event) ?? start)).replace(/-/g, "")}`,
    );
  else {
    lines.push(`DTSTART:${utcStamp(start)}`);
    const end = eventEnd(event);
    if (end) lines.push(`DTEND:${utcStamp(end)}`);
  }
  lines.push(
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(calendarDetails(event, url))}`,
    `LOCATION:${escapeIcs(calendarLocation(event))}`,
    `URL:${escapeIcs(url)}`,
    `STATUS:${event.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
