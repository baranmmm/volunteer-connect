import type { TFunction } from "i18next";
import { londonToIso } from "@/lib/event-rules";

/**
 * RFC 5545 RRULE helpers for recurring events. Rules are evaluated in Europe/London wall-clock time by the
 * database (series_expand); this module only builds, reads and describes them, and exports them.
 * Supported subset (must match series_expand): FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL,
 * BYDAY (weekly list, or one monthly ordinal like 3SA / -1FR), BYMONTHDAY.
 */
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type RepeatFreq = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type RepeatUnit = "day" | "week" | "month";
export type RepeatEnds = "never" | "on" | "after";
export type MonthlyMode = "day" | "weekday";
export type RepeatState = {
  freq: RepeatFreq;
  interval: number;
  unit: RepeatUnit;
  weekdays: Weekday[];
  monthly: MonthlyMode;
  ends: RepeatEnds;
  until: string; // YYYY-MM-DD (London)
  count: number;
};
/** Where the series starts, as typed in the form (London wall clock). */
export type RepeatStart = { date: string; time?: string; allDay: boolean };

export const MAX_COUNT = 1000;
export const defaultRepeat = (): RepeatState => ({
  freq: "none",
  interval: 1,
  unit: "week",
  weekdays: [],
  monthly: "day",
  ends: "never",
  until: "",
  count: 10,
});

/** Monday-based weekday of a YYYY-MM-DD date. */
export function weekdayOf(date: string): Weekday {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(day + 6) % 7]!;
}
/** 1..4 for the nth weekday of the month, -1 for the last one (a 5th weekday is always the last). */
export function nthWeekdayOf(date: string): number {
  const day = Number(date.slice(8, 10));
  const nth = Math.ceil(day / 7);
  return nth >= 5 ? -1 : nth;
}

function untilValue(state: RepeatState, start: RepeatStart) {
  if (start.allDay) return state.until.replace(/-/g, "");
  // End of the chosen London day, as UTC (RFC 5545: UNTIL is UTC when DTSTART has a time zone).
  const iso = new Date(Date.parse(londonToIso(`${state.until}T23:59`)) + 59_000).toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Form state -> RRULE (without the "RRULE:" prefix), or null for "does not repeat". */
export function buildRule(state: RepeatState, start: RepeatStart): string | null {
  if (state.freq === "none" || !start.date) return null;
  const parts: string[] = [];
  const unit = state.freq === "custom" ? state.unit : null;
  const freq =
    state.freq === "daily" || unit === "day"
      ? "DAILY"
      : state.freq === "weekly" || unit === "week"
        ? "WEEKLY"
        : state.freq === "monthly" || unit === "month"
          ? "MONTHLY"
          : "YEARLY";
  parts.push(`FREQ=${freq}`);
  if (state.freq === "custom" && state.interval > 1)
    parts.push(`INTERVAL=${Math.min(999, Math.floor(state.interval))}`);
  if (freq === "WEEKLY") {
    const days = state.weekdays.length
      ? WEEKDAYS.filter((d) => state.weekdays.includes(d))
      : [weekdayOf(start.date)];
    parts.push(`BYDAY=${days.join(",")}`);
  }
  if (freq === "MONTHLY") {
    if (state.monthly === "weekday")
      parts.push(`BYDAY=${nthWeekdayOf(start.date)}${weekdayOf(start.date)}`);
    else parts.push(`BYMONTHDAY=${Number(start.date.slice(8, 10))}`);
  }
  if (state.ends === "after")
    parts.push(`COUNT=${Math.max(1, Math.min(MAX_COUNT, Math.floor(state.count)))}`);
  if (state.ends === "on" && state.until) parts.push(`UNTIL=${untilValue(state, start)}`);
  return parts.join(";");
}

function fields(rule: string) {
  return Object.fromEntries(
    rule
      .toUpperCase()
      .replace(/^RRULE:/, "")
      .split(";")
      .filter(Boolean)
      .map((p) => p.split("=") as [string, string]),
  );
}

/** UNTIL -> London YYYY-MM-DD. */
export function untilDate(until: string): string {
  if (/^\d{8}$/.test(until))
    return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(until);
  if (!m) return "";
  const instant = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(instant);
}

/** RRULE -> form state (for editing a series). */
export function parseRule(rule: string | null | undefined): RepeatState {
  const state = defaultRepeat();
  if (!rule) return state;
  const f = fields(rule);
  const interval = Number(f["INTERVAL"] ?? 1);
  const byday = (f["BYDAY"] ?? "").split(",").filter(Boolean);
  if (interval > 1 && f["FREQ"] !== "YEARLY") {
    state.freq = "custom";
    state.interval = interval;
    state.unit = f["FREQ"] === "DAILY" ? "day" : f["FREQ"] === "MONTHLY" ? "month" : "week";
  } else {
    state.freq =
      f["FREQ"] === "DAILY"
        ? "daily"
        : f["FREQ"] === "WEEKLY"
          ? "weekly"
          : f["FREQ"] === "MONTHLY"
            ? "monthly"
            : "yearly";
  }
  if (f["FREQ"] === "WEEKLY") state.weekdays = WEEKDAYS.filter((d) => byday.includes(d));
  if (f["FREQ"] === "MONTHLY") state.monthly = byday.length ? "weekday" : "day";
  if (f["COUNT"]) {
    state.ends = "after";
    state.count = Number(f["COUNT"]);
  } else if (f["UNTIL"]) {
    state.ends = "on";
    state.until = untilDate(f["UNTIL"]);
  }
  return state;
}

function weekdayName(day: Weekday, locale: string) {
  // 2024-01-01 was a Monday.
  const date = new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(day), 12));
  const name = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date);
  return locale.startsWith("tr") ? name.toLocaleLowerCase("tr") : name;
}
function list(items: string[], locale: string) {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/** Human summary, e.g. "Every Tuesday at 18:00" / "Her salı 18:00". */
export function describeRule(
  rule: string | null | undefined,
  start: RepeatStart,
  t: TFunction,
  locale: string,
): string {
  if (!rule || !start.date) return t("events.repeat.summaryNone");
  const f = fields(rule);
  const interval = Number(f["INTERVAL"] ?? 1);
  const byday = (f["BYDAY"] ?? "").split(",").filter(Boolean);
  const dateLabel = (d: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
      new Date(`${d}T12:00:00Z`),
    );
  let text: string;
  switch (f["FREQ"]) {
    case "DAILY":
      text = t("events.repeat.summaryDaily", { count: interval });
      break;
    case "WEEKLY": {
      const days = list(
        (byday.length ? byday : [weekdayOf(start.date)]).map((d) =>
          weekdayName(d as Weekday, locale),
        ),
        locale,
      );
      text = t("events.repeat.summaryWeekly", { count: interval, days });
      break;
    }
    case "MONTHLY":
      if (byday[0]) {
        const nth = byday[0].slice(0, -2),
          day = byday[0].slice(-2) as Weekday;
        text = t("events.repeat.summaryMonthlyWeekday", {
          count: interval,
          nth: t(`events.repeat.nth.${nth}`),
          weekday: weekdayName(day, locale),
        });
      } else {
        text = t("events.repeat.summaryMonthlyDay", {
          count: interval,
          day: Number(f["BYMONTHDAY"] ?? start.date.slice(8, 10)),
        });
      }
      break;
    default:
      text = t("events.repeat.summaryYearly", { count: interval, date: dateLabel(start.date) });
  }
  if (!start.allDay && start.time) text = t("events.repeat.summaryAt", { text, time: start.time });
  if (f["COUNT"]) text = t("events.repeat.summaryCount", { text, count: Number(f["COUNT"]) });
  else if (f["UNTIL"])
    text = t("events.repeat.summaryUntil", {
      text,
      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${untilDate(f["UNTIL"])}T12:00:00Z`),
      ),
    });
  return text;
}

/** Series data returned by open_series (London wall clock). */
export type SeriesInfo = {
  id: string;
  rule: string;
  timezone: string;
  all_day: boolean;
  dtstart_local: string; // YYYY-MM-DDTHH:mm:ss
  duration_minutes: number | null;
  span_days: number;
  status: string;
  media_event_id: string | null;
  exdates: string[]; // recurrence keys of deleted occurrences
};

const compact = (local: string) => local.slice(0, 19).replace(/[-:]/g, "");
function addLocal(local: string, minutes: number) {
  // Wall-clock arithmetic on a naive timestamp (no time zone involved).
  const d = new Date(`${local.slice(0, 19)}Z`);
  return new Date(d.getTime() + minutes * 60_000).toISOString().slice(0, 19);
}

/** Google Calendar "recur" parameter value. */
export const googleRecur = (series: SeriesInfo) => `RRULE:${series.rule}`;

/** Europe/London VTIMEZONE (EU rules: last Sunday of March/October at 01:00 UTC). */
export const LONDON_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/London",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0000",
  "TZOFFSETTO:+0100",
  "TZNAME:BST",
  "DTSTART:19810329T010000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0000",
  "TZNAME:GMT",
  "DTSTART:19961027T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** DTSTART/DTEND/RRULE/EXDATE lines for a series VEVENT, in London local time so DST never shifts it. */
export function seriesIcsLines(series: SeriesInfo): string[] {
  if (series.all_day) {
    const start = series.dtstart_local.slice(0, 10);
    const end = addLocal(`${start}T00:00:00`, (series.span_days + 1) * 1440).slice(0, 10);
    const lines = [
      `DTSTART;VALUE=DATE:${start.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${end.replace(/-/g, "")}`,
      `RRULE:${series.rule}`,
    ];
    if (series.exdates.length)
      lines.push(
        `EXDATE;VALUE=DATE:${series.exdates.map((d) => d.slice(0, 10).replace(/-/g, "")).join(",")}`,
      );
    return lines;
  }
  const lines = [
    `DTSTART;TZID=Europe/London:${compact(series.dtstart_local)}`,
    `DTEND;TZID=Europe/London:${compact(addLocal(series.dtstart_local, series.duration_minutes ?? 60))}`,
    `RRULE:${series.rule}`,
  ];
  if (series.exdates.length)
    lines.push(`EXDATE;TZID=Europe/London:${series.exdates.map(compact).join(",")}`);
  return lines;
}
