// Small London-time formatters for the landing page. Kept free of date libraries so the signed-out entry stays light.
import { dateLocale } from "@/lib/i18n";

const TZ = "Europe/London";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type Timed = {
  all_day: boolean;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
};

const asDate = (value: string) => new Date(DATE_ONLY.test(value) ? `${value}T12:00:00Z` : value);
const fmt = (value: string, lang: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(dateLocale(lang), { timeZone: TZ, ...opts }).format(asDate(value));

export function startOf(event: Timed) {
  return event.all_day ? event.start_date : event.start_at;
}

/** Day and short month for the date badge. */
export function badgeParts(value: string, lang: string) {
  return { day: fmt(value, lang, { day: "numeric" }), month: fmt(value, lang, { month: "short" }) };
}

/** "Saturday 6 December 2026, 18:30" (long) or "Sat 6 Dec, 18:30" (short); dates only for all-day events. */
export function whenText(event: Timed, lang: string, long = false) {
  const start = startOf(event);
  if (!start) return null;
  const day: Intl.DateTimeFormatOptions = long
    ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    : { weekday: "short", day: "numeric", month: "short" };
  const end = event.all_day ? event.end_date : null;
  if (event.all_day || DATE_ONLY.test(start))
    return end && end !== start
      ? `${fmt(start, lang, day)} – ${fmt(end, lang, day)}`
      : fmt(start, lang, day);
  return `${fmt(start, lang, day)}, ${fmt(start, lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

/** A past event's date (gallery group). */
export function longDate(value: string, lang: string) {
  return fmt(value, lang, { day: "numeric", month: "long", year: "numeric" });
}

/** The machine-readable value for <time dateTime>. */
export function isoOf(value: string) {
  return DATE_ONLY.test(value) ? value : new Date(value).toISOString();
}
