import { describe, expect, it } from "vitest";
import type { HubEvent } from "@/lib/event-rules";
import { eventDisplayStatus, ownDrafts, upcomingDashboardEvents } from "@/lib/event-status";

const NOW = new Date("2026-11-21T12:00:00Z");
const base: HubEvent = {
  id: "base",
  title: "Event",
  description: "",
  location: "London",
  organizer: "Dialogue Society",
  category: "dialogue",
  start_at: "2026-11-22T18:00:00Z",
  end_at: "2026-11-22T20:00:00Z",
  capacity: null, registration_enabled: true,
  scope: "branch",
  branch_id: "b",
  region_id: "r",
  status: "published",
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "",
  created_by: "me",
  deleted_at: null,
  deleted_by: null,
  all_day: false,
  start_date: null,
  end_date: null,
  location_type: "in_person",
  online_url: null,
  series_id: null,
  recurrence_key: null,
  series_exception: false,
  series_template: false,
  deleted_with_series: false,
  media: [],
};
const ev = (over: Partial<HubEvent>): HubEvent => ({ ...base, ...over });
const ids = (events: HubEvent[]) => events.map((e) => e.id);

describe("eventDisplayStatus", () => {
  it("maps stored statuses and marks running published events as live", () => {
    expect(eventDisplayStatus(ev({ status: "draft" }), NOW)).toBe("draft");
    expect(
      eventDisplayStatus(
        ev({
          status: "cancelled",
          start_at: "2026-11-21T11:00:00Z",
          end_at: "2026-11-21T13:00:00Z",
        }),
        NOW,
      ),
    ).toBe("cancelled");
    expect(eventDisplayStatus(ev({}), NOW)).toBe("published");
    expect(
      eventDisplayStatus(
        ev({ start_at: "2026-11-21T11:00:00Z", end_at: "2026-11-21T13:00:00Z" }),
        NOW,
      ),
    ).toBe("live");
  });
});

describe("upcomingDashboardEvents", () => {
  it("puts events happening now first, then nearest start; all-day events sort by date", () => {
    const events = [
      ev({ id: "later", start_at: "2026-11-25T10:00:00Z", end_at: "2026-11-25T11:00:00Z" }),
      ev({ id: "tomorrow", start_at: "2026-11-22T09:00:00Z", end_at: "2026-11-22T10:00:00Z" }),
      ev({
        id: "allday-23",
        all_day: true,
        start_at: null,
        end_at: null,
        start_date: "2026-11-23",
        end_date: "2026-11-23",
      }),
      ev({ id: "live", start_at: "2026-11-21T10:00:00Z", end_at: "2026-11-21T15:00:00Z" }),
      ev({
        id: "allday-today",
        all_day: true,
        start_at: null,
        end_at: null,
        start_date: "2026-11-21",
        end_date: "2026-11-21",
      }),
    ];
    expect(ids(upcomingDashboardEvents(events, NOW))).toEqual([
      "allday-today",
      "live",
      "tomorrow",
      "allday-23",
      "later",
    ]);
  });
  it("excludes drafts, past and unscheduled events, and keeps at most 5", () => {
    const events = [
      ev({ id: "draft", status: "draft" }),
      ev({ id: "past", start_at: "2026-11-20T10:00:00Z", end_at: "2026-11-20T11:00:00Z" }),
      ev({ id: "unscheduled", start_at: null, end_at: null }),
      ...[1, 2, 3, 4, 5, 6].map((n) =>
        ev({
          id: `p${n}`,
          start_at: `2026-11-2${n + 1}T10:00:00Z`,
          end_at: `2026-11-2${n + 1}T11:00:00Z`,
        }),
      ),
    ];
    expect(ids(upcomingDashboardEvents(events, NOW))).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });
  it("shows cancelled events only within the next 7 days", () => {
    const events = [
      ev({
        id: "cancelled-soon",
        status: "cancelled",
        start_at: "2026-11-27T10:00:00Z",
        end_at: "2026-11-27T11:00:00Z",
      }),
      ev({
        id: "cancelled-later",
        status: "cancelled",
        start_at: "2026-11-28T12:00:01Z",
        end_at: "2026-11-28T13:00:00Z",
      }),
      ev({
        id: "cancelled-allday-day7",
        status: "cancelled",
        all_day: true,
        start_at: null,
        end_at: null,
        start_date: "2026-11-28",
        end_date: "2026-11-28",
      }),
      ev({
        id: "cancelled-allday-day8",
        status: "cancelled",
        all_day: true,
        start_at: null,
        end_at: null,
        start_date: "2026-11-29",
        end_date: "2026-11-29",
      }),
    ];
    expect(ids(upcomingDashboardEvents(events, NOW))).toEqual([
      "cancelled-soon",
      "cancelled-allday-day7",
    ]);
  });
});

describe("ownDrafts", () => {
  it("returns only the user's own drafts, newest first, at most 5", () => {
    const events = [
      ev({ id: "published", status: "published" }),
      ev({ id: "other", status: "draft", created_by: "someone-else" }),
      ...[1, 2, 3, 4, 5, 6].map((n) =>
        ev({ id: `d${n}`, status: "draft", created_at: `2026-11-0${n}T00:00:00Z` }),
      ),
    ];
    expect(ids(ownDrafts(events, "me"))).toEqual(["d6", "d5", "d4", "d3", "d2"]);
    expect(ownDrafts(events, undefined)).toEqual([]);
  });
});
