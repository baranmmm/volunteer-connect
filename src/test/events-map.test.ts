import { describe, expect, it } from "vitest";
import {
  addMonths,
  filterTimeline,
  groupPlaces,
  isPastEvent,
  mapLocation,
  markerKind,
  monthCounts,
  pastEventHref,
  playNext,
  playStart,
  selectedMonths,
  sliderKey,
  timelineMonths,
  type MapEvent,
} from "@/lib/events-map";
import { publicEventSchema } from "@/lib/public-events";
import { pastWindow } from "@/lib/events-map.server";

// The public events map: where an event is drawn, the timeline filter and Play (pure, no network).
const NOW = new Date("2026-11-24T12:00:00Z");
const BRANCH = { latitude: 51.3781, longitude: 0.5, precision: "branch" as const };
const VENUE = { latitude: 51.39, longitude: 0.52, precision: "venue" as const };

let n = 0;
function ev(over: Partial<MapEvent> = {}): MapEvent {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: `Event ${n}`,
    all_day: false,
    start_at: "2026-12-05T18:30:00Z",
    end_at: "2026-12-05T20:30:00Z",
    start_date: null,
    end_date: null,
    branch: "Medway",
    region: "South",
    location: "Hall",
    is_online: false,
    has_image: false,
    registration: "open",
    location_tba: false,
    map: BRANCH,
    ...over,
  };
}

describe("map location fallback", () => {
  it("venue, then branch, then none; online events are never drawn", () => {
    expect(mapLocation(ev({ map: VENUE }))).toEqual(VENUE);
    expect(mapLocation(ev({ map: BRANCH }))).toEqual(BRANCH);
    expect(mapLocation(ev({ map: null }))).toBeNull();
    expect(mapLocation(ev({ map: undefined }))).toBeNull();
    expect(mapLocation(ev({ is_online: true, map: BRANCH }))).toBeNull();
  });
  it("'to be announced' never shows a venue point; the branch point is fine", () => {
    expect(mapLocation(ev({ location_tba: true, map: VENUE }))).toBeNull();
    expect(mapLocation(ev({ location_tba: true, map: BRANCH }))).toEqual(BRANCH);
  });
  it("the public schema keeps the map point", () => {
    const parsed = publicEventSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      title: "x",
      description: "",
      status: "published",
      scope: "branch",
      all_day: false,
      start_at: null,
      end_at: null,
      start_date: null,
      end_date: null,
      branch_id: null,
      branch: null,
      region_id: null,
      region: null,
      category: "dialogue",
      location: null,
      is_online: false,
      organizer: null,
      registration: "open",
      has_image: false,
      map: VENUE,
    });
    expect(parsed.map).toEqual(VENUE);
  });
  it("events at one point share a marker; kinds: event, tba, past", () => {
    const a = ev(),
      b = ev({ location_tba: true }),
      c = ev({ map: VENUE }),
      old = ev({ start_at: "2026-03-01T10:00:00Z", end_at: "2026-03-01T12:00:00Z", map: VENUE });
    const places = groupPlaces([a, b, c, old], NOW);
    expect(places).toHaveLength(2);
    const branch = places.find((p) => p.precision === "branch")!;
    expect(branch.events.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(branch.kind).toBe("event");
    expect(groupPlaces([b], NOW)[0]!.kind).toBe("tba");
    expect(groupPlaces([old], NOW)[0]!.kind).toBe("past");
    expect(places.find((p) => p.precision === "venue")!.kind).toBe("event");
    expect(markerKind(old, NOW)).toBe("past");
  });
});

describe("timeline filtering", () => {
  const dec = ev({ start_at: "2026-12-05T18:30:00Z", end_at: "2026-12-05T20:30:00Z" });
  const feb = ev({
    all_day: true,
    start_at: null,
    end_at: null,
    start_date: "2027-02-27",
    end_date: "2027-03-02",
  });
  const past = ev({
    all_day: true,
    start_at: null,
    end_at: null,
    start_date: "2026-07-08",
    end_date: "2026-07-08",
  });
  // 30 Nov 23:30 to 1 Dec 00:30 in London (GMT): in both months, still to come.
  const london = ev({ start_at: "2026-11-30T23:30:00Z", end_at: "2026-12-01T00:30:00Z" });
  const all = [dec, feb, past, london];

  it("months: this month and 11 more; with past events also the 12 before", () => {
    const months = timelineMonths(NOW, false);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-11");
    expect(months[11]).toBe("2027-10");
    const withPast = timelineMonths(NOW, true);
    expect(withPast).toHaveLength(24);
    expect(withPast[0]).toBe("2025-11");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("one month, a range, and all months", () => {
    const months = timelineMonths(NOW, false);
    const ids = (sel: Parameters<typeof filterTimeline>[1]["selection"]) =>
      filterTimeline(all, { months, selection: sel, withPast: false, now: NOW }).map((e) => e.id);
    expect(ids({ start: 1, span: 1 })).toEqual([dec.id, london.id]);
    expect(ids({ start: 0, span: 1 })).toEqual([london.id]);
    // A multi-day event belongs to every month it overlaps (February and March).
    expect(ids({ start: 4, span: 1 })).toEqual([feb.id]);
    expect(ids({ start: 2, span: 3 })).toEqual([feb.id]);
    expect(ids({ start: 0, span: "all" })).toEqual([dec.id, feb.id, london.id]);
    expect(selectedMonths(months, { start: 11, span: 3 })).toEqual(["2027-10"]);
  });
  it("past events appear only with the toggle", () => {
    const months = timelineMonths(NOW, true);
    const sel = { start: 0, span: "all" as const };
    expect(
      filterTimeline(all, { months, selection: sel, withPast: false, now: NOW }),
    ).not.toContain(past);
    expect(filterTimeline(all, { months, selection: sel, withPast: true, now: NOW })).toContain(
      past,
    );
    expect(isPastEvent(past, NOW)).toBe(true);
    expect(isPastEvent(london, NOW)).toBe(false);
    const counts = monthCounts(all, months, true, NOW);
    expect(counts[months.indexOf("2026-07")]).toBe(1);
    expect(counts[months.indexOf("2027-03")]).toBe(1);
  });
  it("a past event's card leads to its gallery photos, else its public page", () => {
    expect(pastEventHref("abc", new Set(["abc"]))).toBe("/#gallery-abc");
    expect(pastEventHref("abc", new Set())).toBe("/events/abc");
  });
  it("the past window stays within get_public_events' 12-month limit", () => {
    const { from, to } = pastWindow(new Date("2028-02-29T12:00:00Z"));
    const limit = new Date(from);
    limit.setMonth(limit.getMonth() + 12);
    expect(to.getTime()).toBeLessThanOrEqual(limit.getTime());
  });
});

describe("Play and the slider keys", () => {
  const months = timelineMonths(NOW, false);
  it("from all months, Play starts at the current month and steps one month at a time to the end", () => {
    let sel = playStart({ start: 0, span: "all" }, months, NOW);
    expect(sel).toEqual({ start: 0, span: 1 });
    const seen = [sel.start];
    for (let next = playNext(sel, months.length); next; next = playNext(sel, months.length)) {
      sel = next;
      seen.push(sel.start);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
  it("a 3-month range stops when its last month reaches the end; at the end Play starts again", () => {
    expect(playNext({ start: 8, span: 3 }, 12)).toEqual({ start: 9, span: 3 });
    expect(playNext({ start: 9, span: 3 }, 12)).toBeNull();
    expect(playStart({ start: 9, span: 3 }, months, NOW)).toEqual({ start: 0, span: 3 });
    expect(playStart({ start: 4, span: 1 }, months, NOW)).toEqual({ start: 4, span: 1 });
    expect(playNext({ start: 0, span: "all" }, 12)).toBeNull();
    // With past events, the current month sits after the 12 months before it.
    expect(playStart({ start: 0, span: "all" }, timelineMonths(NOW, true), NOW).start).toBe(12);
  });
  it("arrows, Page Up/Down, Home and End (clamped)", () => {
    expect(sliderKey("ArrowRight", 3, 12)).toBe(4);
    expect(sliderKey("ArrowUp", 11, 12)).toBe(11);
    expect(sliderKey("ArrowLeft", 0, 12)).toBe(0);
    expect(sliderKey("ArrowDown", 5, 12)).toBe(4);
    expect(sliderKey("PageUp", 10, 12)).toBe(11);
    expect(sliderKey("PageDown", 2, 12)).toBe(0);
    expect(sliderKey("Home", 7, 12)).toBe(0);
    expect(sliderKey("End", 0, 12)).toBe(11);
    expect(sliderKey("a", 0, 12)).toBeNull();
  });
});
