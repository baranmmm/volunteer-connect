import type { TFunction } from "i18next";
import { formatInTimeZone } from "date-fns-tz";
import { imageDimensions, LONDON } from "@/lib/event-rules";
import { dateLocale } from "@/lib/i18n";
import type { Meeting, MeetingSeriesTask } from "@/lib/meetings";

// Meeting display helpers (London time, like events) and the browser-side image re-encoding for uploads.

/** "Mon, 24 Nov 2026, 18:00–19:30" in London time; a second date is shown when the meeting ends on another day. */
export function meetingWhen(m: Pick<Meeting, "starts_at" | "ends_at">) {
  const locale = dateLocale();
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: LONDON,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: LONDON,
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = new Date(m.starts_at),
    end = new Date(m.ends_at);
  const sameDay =
    formatInTimeZone(start, LONDON, "yyyy-MM-dd") === formatInTimeZone(end, LONDON, "yyyy-MM-dd");
  return sameDay
    ? `${day.format(start)}, ${time.format(start)}–${time.format(end)}`
    : `${day.format(start)}, ${time.format(start)} – ${day.format(end)}, ${time.format(end)}`;
}

/** Images are redrawn on a canvas so EXIF/GPS metadata is never uploaded; other files keep their bytes. */
export async function prepareMeetingFile(
  file: File,
  ext: string,
  contentType: string,
): Promise<File> {
  if (!["jpg", "png", "webp"].includes(ext))
    return file.type ? file : new File([file], file.name, { type: contentType });
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const size = imageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Invalid meeting file");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Invalid meeting file"))),
        contentType,
        0.88,
      ),
    );
    return new File([blob], file.name, { type: contentType });
  } finally {
    bitmap.close();
  }
}

/**
 * The form's repeat settings, checked like the database does: 1-4 weeks/months apart, 2-52 occurrences, the last one
 * at most 12 months after the first. null when valid; otherwise an i18n key.
 */
export function meetingRecurrenceError(
  startIso: string,
  r: { freq: "weekly" | "monthly"; interval: number; count: number },
): string | null {
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 4)
    return "meetings.repeat.errors.interval";
  if (!Number.isInteger(r.count) || r.count < 2 || r.count > 52)
    return "meetings.repeat.errors.count";
  // London wall-clock dates: compare calendar days, so a clock change cannot tip the check.
  const day = formatInTimeZone(new Date(startIso), LONDON, "yyyy-MM-dd");
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const steps = (r.count - 1) * r.interval;
  const last =
    r.freq === "weekly"
      ? Date.UTC(y, m - 1, d + 7 * steps)
      : Date.UTC(y, m - 1 + steps, Math.min(d, daysInMonth(y, m - 1 + steps)));
  const limit = Date.UTC(y, m - 1 + 12, Math.min(d, daysInMonth(y, m - 1 + 12)));
  return last > limit ? "meetings.repeat.errors.tooLong" : null;
}
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** "Mon, 24 Nov 2026" in London time. */
export function meetingDay(iso: string) {
  return new Intl.DateTimeFormat(dateLocale(), {
    timeZone: LONDON,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export const SERIES_TASK_FILTERS = [
  "open",
  "all",
  "todo",
  "in_progress",
  "blocked",
  "done",
] as const;
export type SeriesTaskFilter = (typeof SERIES_TASK_FILTERS)[number];

/** Series tasks shown for a filter: "open" is every status except done. */
export function filterSeriesTasks(tasks: MeetingSeriesTask[], filter: SeriesTaskFilter) {
  if (filter === "all") return tasks;
  if (filter === "open") return tasks.filter((task) => task.status !== "done");
  return tasks.filter((task) => task.status === filter);
}

/** Standing agenda items from the editor's text: one per line, trimmed, blank lines and repeats dropped. */
export function parseStandingAgenda(text: string) {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of text.split("\n")) {
    const title = line.trim().slice(0, 200);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    titles.push(title);
  }
  return titles;
}

/** The collapsed invitees header: the count, the first `shown` names and how many more ("+N"). */
export function inviteesSummary(names: string[], shown = 3) {
  return {
    total: names.length,
    names: names.slice(0, shown),
    more: Math.max(0, names.length - shown),
  };
}

/** "Invitees (8): Ali, Ayse, John +5" (i18n), or "Invitees (0)". */
export function inviteesHeader(t: TFunction, label: string, names: string[]) {
  const s = inviteesSummary(names);
  if (s.total === 0) return t("meetings.inviteesToggle.summaryNone", { label });
  return t(s.more ? "meetings.inviteesToggle.summaryMore" : "meetings.inviteesToggle.summary", {
    label,
    total: s.total,
    names: s.names.join(", "),
    more: s.more,
  });
}

/** Decisions on an agenda item and the tasks created from them (the collapsed row's counts). */
/** The rows under a decision: an "@all" task group counts once (it is one row under its decision). */
export function decisionTaskCount(tasks: unknown[]) {
  const groupOf = (x: unknown) =>
    x && typeof x === "object" && "group_id" in x && typeof x.group_id === "string"
      ? x.group_id
      : null;
  return tasks.filter((x) => !groupOf(x)).length + new Set(tasks.map(groupOf).filter(Boolean)).size;
}

export function agendaCounts(item: { decisions: { tasks: unknown[] }[] }) {
  return {
    decisions: item.decisions.length,
    tasks: item.decisions.reduce((sum, d) => sum + decisionTaskCount(d.tasks), 0),
  };
}
