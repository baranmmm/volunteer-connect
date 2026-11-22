import { describe, expect, it } from "vitest";
import {
  emptyRequestForm,
  requestPayload,
  validateRequestForm,
  type RequestFormFields,
} from "@/lib/event-requests";

const now = new Date("2026-11-22T12:00:00Z");
const form = (extra: Partial<RequestFormFields> = {}): RequestFormFields => ({
  ...emptyRequestForm(),
  title: "Community iftar",
  start: "2026-12-01T18:00",
  end: "2026-12-01T20:00",
  ...extra,
});

describe("event request form rules", () => {
  it("accepts a complete timed request and builds UTC instants", () => {
    expect(validateRequestForm(form(), now)).toEqual({});
    expect(requestPayload(form({ expectedAttendees: "40" }))).toMatchObject({
      all_day: false,
      proposed_start: "2026-12-01T18:00:00.000Z",
      proposed_end: "2026-12-01T20:00:00.000Z",
      proposed_start_date: null,
      expected_attendees: 40,
      online_url: null,
    });
  });
  it("requires a title and a future start; end must follow start", () => {
    expect(validateRequestForm(form({ title: " " }), now)).toMatchObject({
      title: "events.fieldRequired",
    });
    expect(
      validateRequestForm(form({ start: "2026-11-01T18:00", end: "2026-11-01T20:00" }), now),
    ).toMatchObject({ start: "requests.errors.future" });
    expect(validateRequestForm(form({ end: "2026-12-01T17:00" }), now)).toMatchObject({
      end: "events.dateError",
    });
  });
  it("rejects non-https meeting links only for online requests", () => {
    expect(
      validateRequestForm(form({ isOnline: true, onlineUrl: "http://example.org/x" }), now),
    ).toMatchObject({ "online-url": "events.onlineUrlError" });
    expect(
      validateRequestForm(form({ isOnline: true, onlineUrl: "https://meet.example.org/x" }), now),
    ).toEqual({});
    expect(
      requestPayload(form({ isOnline: false, onlineUrl: "https://meet.example.org/x" })).online_url,
    ).toBeNull();
  });
  it("all-day requests use London dates after today; the alternative date is optional", () => {
    const allDay = form({ allDay: true, startDate: "2026-12-05", endDate: "2026-12-06" });
    expect(validateRequestForm(allDay, now)).toEqual({});
    expect(
      validateRequestForm({ ...allDay, startDate: "2026-11-22", endDate: "" }, now),
    ).toMatchObject({ "start-date": "requests.errors.future" });
    expect(validateRequestForm({ ...allDay, endDate: "2026-12-04" }, now)).toMatchObject({
      "end-date": "events.dateError",
    });
    expect(requestPayload(allDay)).toMatchObject({
      proposed_start: null,
      proposed_start_date: "2026-12-05",
      proposed_end_date: "2026-12-06",
    });
    expect(validateRequestForm({ ...allDay, hasAlt: true }, now)).toEqual({});
    expect(
      validateRequestForm({ ...allDay, hasAlt: true, altStartDate: "2026-11-20" }, now),
    ).toMatchObject({ "alt-start-date": "requests.errors.future" });
  });
  it("an added alternative timed date needs both start and end", () => {
    expect(
      validateRequestForm(form({ hasAlt: true, altStart: "2026-12-02T18:00" }), now),
    ).toMatchObject({ "alt-end": "events.fieldRequired" });
    const both = form({ hasAlt: true, altStart: "2026-12-02T18:00", altEnd: "2026-12-02T19:30" });
    expect(validateRequestForm(both, now)).toEqual({});
    expect(requestPayload(both)).toMatchObject({
      alt_start: "2026-12-02T18:00:00.000Z",
      alt_end: "2026-12-02T19:30:00.000Z",
    });
    expect(requestPayload({ ...both, hasAlt: false })).toMatchObject({
      alt_start: null,
      alt_end: null,
    });
  });
});
