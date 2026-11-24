// The public events map and its timeline: pure helpers (no React, no Leaflet, no date libraries, so the signed-out
// pages stay light). Dates are London calendar months; an event belongs to every month it overlaps.
import type { PublicEvent } from "@/lib/public-events";

export type MapPoint = { latitude: number; longitude: number; precision: "venue" | "branch" };
/** A public event as the map reads it (public_event_json; landing rows also carry their signed cover). */
export type MapEvent = Pick<
  PublicEvent,
  | "id"
  | "title"
  | "all_day"
  | "start_at"
  | "end_at"
  | "start_date"
  | "end_date"
  | "branch"
  | "region"
  | "location"
  | "is_online"
  | "has_image"
  | "registration"
> & {
  location_tba?: boolean | undefined;
  past_record?: boolean | undefined;
  map?: MapPoint | null | undefined;
};

export type MarkerKind = "event" | "tba" | "past";

/**
 * Where the map draws an event: the venue when it was geocoded, else the branch's location (public_event_json.map
 * already applies venue → branch → none); online events and events without any location are not drawn.
 */
export function mapLocation(event: MapEvent): MapPoint | null {
  if (event.is_online) return null;
  const m = event.map;
  if (!m || !Number.isFinite(m.latitude) || !Number.isFinite(m.longitude)) return null;
  // "To be announced" never shows a venue point, even if one was stored before.
  if (event.location_tba && m.precision === "venue") return null;
  return m;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LONDON_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" in London for an instant or a date. */
export function londonDay(value: string | Date): string {
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;
  return LONDON_DAY.format(typeof value === "string" ? new Date(value) : value);
}

const TZ = "Europe/London";
const asDate = (v: string) => new Date(DATE_ONLY.test(v) ? `${v}T12:00:00Z` : v);
/** "Sat 6 Dec, 18:30" (all-day: the date, or "date – date"), in London time. Null when unscheduled. */
export function mapWhen(e: MapEvent, lang: string): string | null {
  const start = eventStartValue(e);
  if (!start) return null;
  const locale = lang === "tr" ? "tr-TR" : "en-GB";
  const day = (v: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: TZ,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: isThisYear(v) ? undefined : "numeric",
    }).format(asDate(v));
  if (e.all_day || DATE_ONLY.test(start)) {
    const end = e.all_day ? e.end_date : null;
    return end && end !== start ? `${day(start)} – ${day(end)}` : day(start);
  }
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(asDate(start));
  return `${day(start)}, ${time}`;
}
function isThisYear(v: string) {
  return londonDay(v).slice(0, 4) === londonDay(new Date()).slice(0, 4);
}

export function eventStartValue(e: MapEvent) {
  return e.all_day ? e.start_date : e.start_at;
}
export function eventEndValue(e: MapEvent) {
  return (e.all_day ? (e.end_date ?? e.start_date) : e.end_at) ?? eventStartValue(e);
}

/** True when the event is over (all-day events: after their last London day). */
export function isPastEvent(e: MapEvent, now = new Date()): boolean {
  const end = eventEndValue(e);
  if (!end) return false;
  if (e.all_day || DATE_ONLY.test(end)) return londonDay(end) < londonDay(now);
  return Date.parse(end) < now.getTime();
}

export function markerKind(e: MapEvent, now = new Date()): MarkerKind {
  if (isPastEvent(e, now)) return "past";
  return e.location_tba ? "tba" : "event";
}

/** A month of the timeline: "YYYY-MM". */
export type MonthKey = string;

export function monthOf(day: string): MonthKey {
  return day.slice(0, 7);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * The timeline's months: the current London month and the next 11 (12 months, like the public list), and with past
 * events also the 12 months before.
 */
export function timelineMonths(now: Date, withPast: boolean, ahead = 12, back = 12): MonthKey[] {
  const current = monthOf(londonDay(now));
  const first = withPast ? -back : 0;
  return Array.from({ length: ahead - first }, (_, i) => addMonths(current, first + i));
}

/** The selected part of the timeline: `start` index and how many months (`span`), or every month. */
export type TimelineSelection = { start: number; span: number | "all" };

/** The months a selection covers (clamped to the timeline). */
export function selectedMonths(months: MonthKey[], sel: TimelineSelection): MonthKey[] {
  if (sel.span === "all") return months;
  const start = Math.min(Math.max(sel.start, 0), Math.max(months.length - 1, 0));
  return months.slice(start, start + sel.span);
}

/** Does the event overlap these (consecutive) months? Unscheduled events never do. */
export function inMonths(e: MapEvent, months: MonthKey[]): boolean {
  const start = eventStartValue(e);
  if (!start || !months.length) return false;
  const from = monthOf(londonDay(start)),
    to = monthOf(londonDay(eventEndValue(e) ?? start));
  return from <= months[months.length - 1]! && to >= months[0]!;
}

/**
 * The events the map, the list and the Online panel show: past events only with the toggle on, and only those in the
 * selected months.
 */
export function filterTimeline<T extends MapEvent>(
  events: T[],
  opts: { months: MonthKey[]; selection: TimelineSelection; withPast: boolean; now?: Date },
): T[] {
  const now = opts.now ?? new Date();
  const months = selectedMonths(opts.months, opts.selection);
  return events.filter((e) => (opts.withPast || !isPastEvent(e, now)) && inMonths(e, months));
}

/** Events per timeline month (the tick dots). */
export function monthCounts(
  events: MapEvent[],
  months: MonthKey[],
  withPast: boolean,
  now = new Date(),
) {
  return months.map(
    (m) => events.filter((e) => (withPast || !isPastEvent(e, now)) && inMonths(e, [m])).length,
  );
}

/** The index of the current month on the timeline. */
export function currentMonthIndex(months: MonthKey[], now = new Date()) {
  return Math.max(0, months.indexOf(monthOf(londonDay(now))));
}

/**
 * Play: where the first step goes and each next one. From "all months" playing starts at the current month (the coming
 * months); otherwise one month on. Null at the end (playing stops there).
 */
export function playStart(
  sel: TimelineSelection,
  months: MonthKey[],
  now = new Date(),
): TimelineSelection {
  if (sel.span === "all") return { start: currentMonthIndex(months, now), span: 1 };
  // At the end already: start again from the current month.
  if (sel.start + sel.span >= months.length)
    return { start: currentMonthIndex(months, now), span: sel.span };
  return sel;
}
export function playNext(sel: TimelineSelection, length: number): TimelineSelection | null {
  if (sel.span === "all") return null;
  const next = sel.start + 1;
  return next + sel.span > length ? null : { start: next, span: sel.span };
}

/** Keyboard on the slider: arrows ±1, Page keys ±3, Home/End; null for any other key. */
export function sliderKey(key: string, index: number, length: number): number | null {
  const last = Math.max(length - 1, 0);
  const clamp = (n: number) => Math.min(Math.max(n, 0), last);
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(index - 1);
    case "ArrowRight":
    case "ArrowUp":
      return clamp(index + 1);
    case "PageDown":
      return clamp(index - 3);
    case "PageUp":
      return clamp(index + 3);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/** Events at the same point share one marker (many events use their branch's location). */
export type MapPlace<T extends MapEvent = MapEvent> = {
  key: string;
  latitude: number;
  longitude: number;
  precision: "venue" | "branch";
  kind: MarkerKind;
  events: T[];
};

export function groupPlaces<T extends MapEvent>(events: T[], now = new Date()): MapPlace<T>[] {
  const places = new Map<string, MapPlace<T>>();
  for (const e of events) {
    const p = mapLocation(e);
    if (!p) continue;
    const key = `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;
    const place = places.get(key) ?? {
      key,
      latitude: p.latitude,
      longitude: p.longitude,
      precision: p.precision,
      kind: "past" as MarkerKind,
      events: [],
    };
    place.events.push(e);
    if (p.precision === "venue") place.precision = "venue";
    places.set(key, place);
  }
  for (const place of places.values()) {
    const kinds = place.events.map((e) => markerKind(e, now));
    // Anything still to come wins over past; a place is "to be announced" only when all its coming events are.
    const coming = kinds.filter((k) => k !== "past");
    place.kind = !coming.length ? "past" : coming.every((k) => k === "tba") ? "tba" : "event";
  }
  return [...places.values()];
}

/** The bounds of the places, or null without any ([south, west], [north, east]). */
export function placeBounds(places: { latitude: number; longitude: number }[]) {
  if (!places.length) return null;
  let s = 90,
    w = 180,
    n = -90,
    e = -180;
  for (const p of places) {
    s = Math.min(s, p.latitude);
    n = Math.max(n, p.latitude);
    w = Math.min(w, p.longitude);
    e = Math.max(e, p.longitude);
  }
  return [
    [s, w],
    [n, e],
  ] as [[number, number], [number, number]];
}

/** Where a past event's card leads: its photos in the landing gallery, else its public page. */
export function pastEventHref(id: string, galleryIds: ReadonlySet<string>) {
  return galleryIds.has(id) ? `/#gallery-${id}` : `/events/${id}`;
}
