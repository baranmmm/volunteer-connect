import { afterEach, describe, expect, it } from "vitest";
import i18n, { setLanguage } from "@/lib/i18n";
import {
  buildRule,
  defaultRepeat,
  describeRule,
  parseRule,
  seriesIcsLines,
  type RepeatState,
  type SeriesInfo,
} from "@/lib/recurrence";
import { eventIcs, googleCalendarUrl, type HubEvent } from "@/lib/event-rules";

const repeat = (patch: Partial<RepeatState>): RepeatState => ({ ...defaultRepeat(), ...patch });
const tue = { date: "2026-12-01", time: "18:00", allDay: false }; // a Tuesday
afterEach(() => setLanguage("en"));

describe("buildRule", () => {
  it("weekly defaults to the start's weekday; COUNT and UNTIL ends", () => {
    expect(buildRule(repeat({ freq: "weekly", ends: "after", count: 8 }), tue)).toBe(
      "FREQ=WEEKLY;BYDAY=TU;COUNT=8",
    );
    expect(buildRule(repeat({ freq: "none" }), tue)).toBeNull();
    // End of the London day in UTC: GMT in January, BST in June.
    expect(buildRule(repeat({ freq: "daily", ends: "on", until: "2027-01-10" }), tue)).toBe(
      "FREQ=DAILY;UNTIL=20270110T235959Z",
    );
    expect(buildRule(repeat({ freq: "daily", ends: "on", until: "2027-06-10" }), tue)).toBe(
      "FREQ=DAILY;UNTIL=20270610T225959Z",
    );
    expect(
      buildRule(repeat({ freq: "daily", ends: "on", until: "2027-06-10" }), {
        date: "2026-12-01",
        allDay: true,
      }),
    ).toBe("FREQ=DAILY;UNTIL=20270610");
  });
  it("monthly by day of month or nth weekday (3rd Saturday, last Friday); custom intervals", () => {
    expect(
      buildRule(repeat({ freq: "monthly" }), { date: "2027-01-16", time: "10:00", allDay: false }),
    ).toBe("FREQ=MONTHLY;BYMONTHDAY=16");
    expect(
      buildRule(repeat({ freq: "monthly", monthly: "weekday" }), {
        date: "2027-01-16",
        time: "10:00",
        allDay: false,
      }),
    ).toBe("FREQ=MONTHLY;BYDAY=3SA");
    expect(
      buildRule(repeat({ freq: "monthly", monthly: "weekday" }), {
        date: "2027-01-29",
        time: "19:00",
        allDay: false,
      }),
    ).toBe("FREQ=MONTHLY;BYDAY=-1FR");
    expect(
      buildRule(repeat({ freq: "custom", interval: 2, unit: "week", weekdays: ["WE", "MO"] }), tue),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
    expect(buildRule(repeat({ freq: "yearly" }), tue)).toBe("FREQ=YEARLY");
  });
  it("parseRule reads back what buildRule wrote", () => {
    for (const state of [
      repeat({ freq: "weekly", weekdays: ["TU"], ends: "after", count: 8 }),
      repeat({ freq: "custom", interval: 3, unit: "month", ends: "on", until: "2027-06-10" }),
      repeat({ freq: "monthly", monthly: "weekday" }),
    ]) {
      const rule = buildRule(state, tue)!;
      expect(buildRule(parseRule(rule), tue)).toBe(rule);
    }
  });
});

describe("describeRule", () => {
  it("English and Turkish summaries", () => {
    setLanguage("en");
    expect(describeRule("FREQ=WEEKLY;BYDAY=TU", tue, i18n.t, "en-GB")).toBe(
      "Every Tuesday at 18:00",
    );
    expect(describeRule("FREQ=WEEKLY;BYDAY=TU;COUNT=8", tue, i18n.t, "en-GB")).toBe(
      "Every Tuesday at 18:00, 8 times",
    );
    expect(
      describeRule(
        "FREQ=MONTHLY;BYDAY=3SA",
        { date: "2027-01-16", time: "10:00", allDay: false },
        i18n.t,
        "en-GB",
      ),
    ).toBe("Monthly on the third Saturday at 10:00");
    setLanguage("tr");
    expect(describeRule("FREQ=WEEKLY;BYDAY=TU", tue, i18n.t, "tr-TR")).toBe("Her salı 18:00");
    expect(
      describeRule(
        "FREQ=MONTHLY;BYDAY=3SA",
        { date: "2027-01-16", time: "10:00", allDay: false },
        i18n.t,
        "tr-TR",
      ),
    ).toBe("Her ayın 3. cumartesi 10:00");
    expect(describeRule(null, tue, i18n.t, "tr-TR")).toBe("Tekrarlamaz");
  });
});

describe("calendar export of a series", () => {
  const series: SeriesInfo = {
    id: "series-1",
    rule: "FREQ=WEEKLY;BYDAY=TU;COUNT=8",
    timezone: "Europe/London",
    all_day: false,
    dtstart_local: "2027-03-16T18:00:00",
    duration_minutes: 90,
    span_days: 0,
    status: "published",
    media_event_id: null,
    exdates: ["2027-03-30T18:00:00"],
  };
  const event = {
    id: "e1",
    title: "Dialogue evening",
    description: "",
    location: "Hall",
    location_type: "in_person",
    online_url: null,
    status: "published",
    start_at: "2027-03-16T18:00:00Z",
    end_at: "2027-03-16T19:30:00Z",
    all_day: false,
    start_date: null,
    end_date: null,
  } as unknown as HubEvent;
  it(".ics uses London local time, RRULE and EXDATE (so DST never shifts it)", () => {
    expect(seriesIcsLines(series)).toEqual([
      "DTSTART;TZID=Europe/London:20270316T180000",
      "DTEND;TZID=Europe/London:20270316T193000",
      "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=8",
      "EXDATE;TZID=Europe/London:20270330T180000",
    ]);
    const ics = eventIcs(
      event,
      "https://example.org/events/e1",
      new Date("2026-11-22T00:00:00Z"),
      series,
    );
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("UID:series-series-1@dialoguesociety.org");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=8");
  });
  it("all-day series use DATE values", () => {
    expect(
      seriesIcsLines({
        ...series,
        all_day: true,
        dtstart_local: "2027-03-16T00:00:00",
        span_days: 1,
        exdates: ["2027-03-30T00:00:00"],
      }),
    ).toEqual([
      "DTSTART;VALUE=DATE:20270316",
      "DTEND;VALUE=DATE:20270318",
      "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=8",
      "EXDATE;VALUE=DATE:20270330",
    ]);
  });
  it("Google link adds recur=RRULE and the series start in London time", () => {
    const url = new URL(googleCalendarUrl(event, "https://example.org/events/e1", series));
    expect(url.searchParams.get("recur")).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=8");
    expect(url.searchParams.get("dates")).toBe("20270316T180000/20270316T193000");
    expect(url.searchParams.get("ctz")).toBe("Europe/London");
  });
});
