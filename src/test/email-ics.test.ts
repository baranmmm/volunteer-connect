import { describe, expect, it } from "vitest";
import {
  escapeIcsText,
  foldIcsLine,
  icsUid,
  LOCATION_TBA_TEXT,
  ONLINE_TEXT,
  registrationIcs,
  type IcsEvent,
} from "@/lib/email/ics";

const REG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const event: IcsEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Community dinner",
  description: "A shared meal",
  location: "Hall 1, London",
  location_type: "in_person",
  location_tba: false,
  all_day: false,
  start_at: "2027-06-01T17:00:00Z",
  end_at: "2027-06-01T19:30:00Z",
  start_date: null,
  end_date: null,
  ics_sequence: 0,
  status: "published",
};
const base = {
  registrationId: REG,
  organizer: { email: "events@example.org", name: "Dialogue Society" },
  attendee: { email: "guest@example.org", name: "Ada Guest" },
  url: "https://hub.example.org/events/11111111-1111-4111-8111-111111111111",
  now: new Date("2027-05-01T10:00:00Z"),
};
const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const lines = (ics: string) => unfold(ics).split("\r\n");
const prop = (ics: string, name: string) =>
  lines(ics).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

describe("registration .ics", () => {
  it("is a REQUEST with a stable UID per registration and the event's sequence", () => {
    const a = registrationIcs({ ...base, method: "REQUEST", event, sequence: event.ics_sequence })!;
    const b = registrationIcs({
      ...base,
      method: "REQUEST",
      event: { ...event, title: "Renamed" },
      sequence: 0,
    })!;
    expect(prop(a, "METHOD")).toBe("METHOD:REQUEST");
    expect(prop(a, "UID")).toBe(`UID:${REG}@dialoguesociety-hub`);
    expect(prop(b, "UID")).toBe(prop(a, "UID"));
    expect(icsUid(REG)).toBe(`${REG}@dialoguesociety-hub`);
    expect(prop(a, "SEQUENCE")).toBe("SEQUENCE:0");
    expect(prop(a, "STATUS")).toBe("STATUS:CONFIRMED");
    expect(prop(a, "DTSTAMP")).toBe("DTSTAMP:20270501T100000Z");
    expect(prop(a, "DTSTART")).toBe("DTSTART:20270601T170000Z");
    expect(prop(a, "DTEND")).toBe("DTEND:20270601T193000Z");
    expect(prop(a, "ORGANIZER")).toBe('ORGANIZER;CN="Dialogue Society":mailto:events@example.org');
    expect(prop(a, "ATTENDEE")).toContain("mailto:guest@example.org");
    expect(prop(a, "LOCATION")).toBe("LOCATION:Hall 1\\, London");
  });

  it("an update keeps the UID and carries the bumped sequence", () => {
    const first = registrationIcs({ ...base, method: "REQUEST", event, sequence: 0 })!;
    const moved = {
      ...event,
      start_at: "2027-06-02T17:00:00Z",
      end_at: "2027-06-02T19:00:00Z",
      ics_sequence: 1,
    };
    const update = registrationIcs({
      ...base,
      method: "REQUEST",
      event: moved,
      sequence: moved.ics_sequence,
    })!;
    expect(prop(update, "UID")).toBe(prop(first, "UID"));
    expect(prop(update, "SEQUENCE")).toBe("SEQUENCE:1");
    expect(prop(update, "DTSTART")).toBe("DTSTART:20270602T170000Z");
  });

  it("cancellations are METHOD:CANCEL with STATUS:CANCELLED", () => {
    const cancelled = { ...event, status: "cancelled", ics_sequence: 2 };
    const ics = registrationIcs({
      ...base,
      method: "CANCEL",
      event: cancelled,
      sequence: cancelled.ics_sequence,
    })!;
    expect(prop(ics, "METHOD")).toBe("METHOD:CANCEL");
    expect(prop(ics, "STATUS")).toBe("STATUS:CANCELLED");
    expect(prop(ics, "SEQUENCE")).toBe("SEQUENCE:2");
    expect(prop(ics, "UID")).toBe(`UID:${REG}@dialoguesociety-hub`);
  });

  it("all-day events use VALUE=DATE with an exclusive end", () => {
    const allDay = {
      ...event,
      all_day: true,
      start_at: null,
      end_at: null,
      start_date: "2027-06-01",
      end_date: "2027-06-03",
    };
    const ics = registrationIcs({ ...base, method: "REQUEST", event: allDay, sequence: 0 })!;
    expect(prop(ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20270601");
    expect(prop(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20270604");
    const single = registrationIcs({
      ...base,
      method: "REQUEST",
      event: { ...allDay, end_date: null },
      sequence: 0,
    })!;
    expect(prop(single, "DTEND")).toBe("DTEND;VALUE=DATE:20270602");
  });

  it("TBA and online places never include a link", () => {
    const tba = registrationIcs({
      ...base,
      method: "REQUEST",
      event: { ...event, location_tba: true, location: "" },
      sequence: 0,
    })!;
    expect(prop(tba, "LOCATION")).toBe(`LOCATION:${LOCATION_TBA_TEXT}`);
    const online = registrationIcs({
      ...base,
      method: "REQUEST",
      event: { ...event, location_type: "online", location: "" },
      sequence: 0,
    })!;
    expect(prop(online, "LOCATION")).toBe(`LOCATION:${escapeIcsText(ONLINE_TEXT)}`);
    expect(online).not.toContain("meet.");
  });

  it("returns null for an event without a date", () => {
    expect(
      registrationIcs({
        ...base,
        method: "REQUEST",
        event: { ...event, start_at: null },
        sequence: 0,
      }),
    ).toBeNull();
  });

  it("escapes text and folds long lines at 75 octets with CRLF", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = {
      ...event,
      title: `Dialogue évening ${"çok güzel ".repeat(20)}`,
      description: "Line one\nLine two, with; marks",
    };
    const ics = registrationIcs({ ...base, method: "REQUEST", event: long, sequence: 0 })!;
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of ics.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(prop(ics, "SUMMARY")).toBe(`SUMMARY:${long.title.replace(/,/g, "\\,")}`);
    expect(prop(ics, "DESCRIPTION")).toContain("Line one\\nLine two\\, with\\; marks");
    // Folding never splits a multi-byte character.
    const folded = foldIcsLine(`X:${"ğ".repeat(80)}`);
    expect(folded.split("\r\n ").join("")).toBe(`X:${"ğ".repeat(80)}`);
  });

  it("names with quotes cannot break the parameter", () => {
    const ics = registrationIcs({
      ...base,
      attendee: { email: "g@example.org", name: 'Bad "Name"\nX' },
      method: "REQUEST",
      event,
      sequence: 0,
    })!;
    expect(prop(ics, "ATTENDEE")).toContain('CN="Bad  Name  X":mailto:g@example.org');
  });
});
