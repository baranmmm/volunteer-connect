import { describe, expect, it } from "vitest";
import {
  eventOccursOn,
  eventTimeState,
  eventWhen,
  googleCalendarUrl,
  outlookCalendarUrl,
  eventIcs,
  validateEventFile,
  eventFileExtension,
  DOCX_MIME,
  PPTX_MIME,
  type HubEvent,
} from "@/lib/event-rules";
import { validateEventForm } from "@/lib/event-form-rules";

const base: HubEvent = {
  id: "e1",
  title: "Weekend retreat",
  description: "Talks & food",
  location: "London",
  organizer: "Dialogue Society",
  category: "dialogue",
  start_at: null,
  end_at: null,
  all_day: true,
  start_date: "2027-03-27",
  end_date: "2027-03-28",
  location_type: "in_person",
  online_url: null,
  capacity: null,
  registration_enabled: true,
  is_external: false,
  location_tba: false,
  max_places: 1,
  ics_sequence: 0,
  past_record: false,
  postcode: null,
  latitude: null,
  longitude: null,
  located_at: null,
  audience: "members",
  scope: "branch",
  branch_id: "b",
  region_id: "r",
  status: "published",
  created_by: null,
  created_at: "",
  updated_at: "",
  deleted_at: null,
  deleted_by: null,
  series_id: null,
  recurrence_key: null,
  series_exception: false,
  series_template: false,
  deleted_with_series: false,
  media: [],
};
const timed: HubEvent = {
  ...base,
  all_day: false,
  start_date: null,
  end_date: null,
  start_at: "2026-11-22T14:00:00Z",
  end_at: "2026-11-22T16:00:00Z",
};
const form = {
  title: "T",
  allDay: false,
  start: "2027-01-10T18:00",
  end: "2027-01-10T20:00",
  startDate: "",
  endDate: "",
  locationType: "in_person" as const,
  location: "London",
  onlineUrl: "",
  category: "dialogue",
  scope: "branch",
  branch: "b",
  capacity: "",
  organizer: "",
};
const now = { now: new Date("2027-01-01T12:00:00Z") };

describe("A2a publish rules", () => {
  it("a draft needs only a title", () => {
    expect(
      validateEventForm(
        { ...form, start: "", end: "", location: "", branch: "", scope: "branch" },
        "draft",
        now,
      ),
    ).toEqual({});
  });
  it("publishing requires start, end, location and branch", () => {
    const errors = validateEventForm(
      { ...form, start: "", end: "", location: "", branch: "" },
      "published",
      now,
    );
    expect(Object.keys(errors).sort()).toEqual(["branch", "end", "location", "start"]);
  });
  it("end must be after start", () => {
    expect(validateEventForm({ ...form, end: "2027-01-10T18:00" }, "published", now)["end"]).toBe(
      "events.dateError",
    );
  });
  it("a published event cannot end in the past but may have started earlier today", () => {
    expect(
      validateEventForm(
        { ...form, start: "2026-12-31T09:00", end: "2026-12-31T10:00" },
        "published",
        now,
      )["end"],
    ).toBe("events.pastPublishError");
    expect(
      validateEventForm(
        { ...form, start: "2027-01-01T09:00", end: "2027-01-01T18:00" },
        "published",
        now,
      ),
    ).toEqual({});
  });
  it("online events need an https meeting link instead of a location", () => {
    const online = { ...form, locationType: "online" as const, location: "" };
    expect(validateEventForm(online, "published", now)["online-url"]).toBe("events.fieldRequired");
    expect(
      validateEventForm({ ...online, onlineUrl: "http://zoom.us/j/1" }, "published", now)[
        "online-url"
      ],
    ).toBe("events.onlineUrlError");
    expect(
      validateEventForm({ ...online, onlineUrl: "https://zoom.us/j/1" }, "published", now),
    ).toEqual({});
  });
  it("an all-day event publishes with only a start date", () => {
    expect(
      validateEventForm(
        { ...form, allDay: true, start: "", end: "", startDate: "2027-01-02" },
        "published",
        now,
      ),
    ).toEqual({});
  });
});

describe("all-day events", () => {
  it("a weekend all-day event shows on both days in any time zone", () => {
    expect(eventOccursOn(base, "2027-03-27")).toBe(true);
    expect(eventOccursOn(base, "2027-03-28")).toBe(true);
    expect(eventOccursOn(base, "2027-03-29")).toBe(false);
  });
  it("is happening now by London date", () => {
    expect(eventTimeState(base, new Date("2027-03-28T23:30:00Z")).happeningNow).toBe(false); // already Monday 00:30 in London (BST)
    expect(eventTimeState(base, new Date("2027-03-28T22:30:00Z")).happeningNow).toBe(true);
  });
});

describe("date display", () => {
  it("same-day timed events do not repeat the date", () => {
    expect(eventWhen(timed, "en-GB")?.text).toBe("Sunday, 22 November 2026, 14:00 – 16:00");
  });
  it("all-day multi-day events show both dates", () => {
    expect(eventWhen(base, "en-GB")).toEqual({
      allDay: true,
      text: "Saturday, 27 March 2027 – Sunday, 28 March 2027",
    });
  });
});

describe("add to calendar", () => {
  it("Google uses London time for timed events", () => {
    const url = new URL(googleCalendarUrl(timed, "https://hub.example/events/e1"));
    expect(url.searchParams.get("dates")).toBe("20261122T140000/20261122T160000");
    expect(url.searchParams.get("ctz")).toBe("Europe/London");
    expect(url.searchParams.get("details")).toContain("https://hub.example/events/e1");
  });
  it("Google all-day end date is exclusive", () => {
    expect(new URL(googleCalendarUrl(base, "u")).searchParams.get("dates")).toBe(
      "20270327/20270329",
    );
  });
  it("Outlook personal and work links use the right hosts and times", () => {
    const personal = new URL(outlookCalendarUrl(timed, "u")),
      work = new URL(outlookCalendarUrl(timed, "u", true));
    expect(personal.host).toBe("outlook.live.com");
    expect(work.host).toBe("outlook.office.com");
    expect(personal.searchParams.get("startdt")).toBe("2026-11-22T14:00:00.000Z");
  });
  it(".ics all-day events are date-only", () => {
    expect(eventIcs(base, "u", new Date("2027-01-01T00:00:00Z"))).toContain(
      "DTSTART;VALUE=DATE:20270327\r\nDTEND;VALUE=DATE:20270329",
    );
  });
});

describe("document uploads", () => {
  it("accepts .docx and .pptx, even when the browser gives no type", () => {
    for (const file of [
      { type: DOCX_MIME, name: "a.docx" },
      { type: PPTX_MIME, name: "b.pptx" },
      { type: "", name: "c.docx" },
    ])
      expect(() => validateEventFile({ ...file, size: 1 }, 0)).not.toThrow();
    expect(eventFileExtension("", "c.pptx")).toBe("pptx");
  });
  it("rejects .doc, .ppt, macro formats and .txt", () => {
    for (const file of [
      { type: "application/msword", name: "a.doc" },
      { type: "application/vnd.ms-powerpoint", name: "a.ppt" },
      { type: "", name: "a.docm" },
      { type: "", name: "a.pptm" },
      { type: "text/plain", name: "a.txt" },
      { type: DOCX_MIME, name: "renamed.docm" },
    ])
      expect(() => validateEventFile({ ...file, size: 1 }, 0)).toThrow("Invalid event file");
  });
});
