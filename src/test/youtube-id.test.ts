import { describe, expect, it } from "vitest";
import { youtubeId } from "@/lib/youtube";
import { attendeesCsv, csvCell, type Attendee } from "@/lib/attendees";
import { pastEventDateOk, validatePastEvent } from "@/lib/past-events";

describe("youtubeId", () => {
  const id = "dQw4w9WgXcQ";
  it.each([
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=42`,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?feature=share&v=${id}`,
    `https://m.youtube.com/watch?v=${id}&list=PL1`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `youtube.com/watch?v=${id}`,
    `  https://youtu.be/${id}  `,
  ])("reads %s", (url) => expect(youtubeId(url)).toBe(id));
  it.each([
    "",
    "not a link",
    "https://vimeo.com/123456",
    "https://youtu.be/short",
    `https://evil.example/watch?v=${id}`,
    `https://youtube.com.evil.example/watch?v=${id}`,
    "https://www.youtube.com/watch?v=<script>xx",
    `javascript:alert(1)//youtu.be/${id}`,
    "https://www.youtube.com/channel/UC1234567890",
  ])("rejects %s", (url) => expect(youtubeId(url)).toBeNull());
});

describe("attendee CSV", () => {
  const row = (over: Partial<Attendee>): Attendee => ({
    registration_id: "r1",
    kind: "member",
    user_id: "u1",
    full_name: "Ayşe Yılmaz",
    email: "a@example.org",
    phone: null,
    places: 1,
    status: "registered",
    registered_at: "2026-11-01T10:00:00Z",
    cancelled_at: null,
    checked_in_at: null,
    checked_in_by_name: null,
    waitlist_position: null,
    ...over,
  });
  it("starts with a BOM, quotes every cell and uses CRLF", () => {
    const csv = attendeesCsv([
      row({}),
      row({ registration_id: "r2", kind: "guest", full_name: 'Sam "S" Lee', places: 3 }),
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      '"name","type","email","phone","places","status","checked_in","registered_at"',
    );
    expect(lines[1]).toContain('"Ayşe Yılmaz","member"');
    expect(lines[2]).toContain('"Sam ""S"" Lee","guest","a@example.org","","3"');
    expect(lines[3]).toBe("");
  });
  it("neutralises spreadsheet formulas", () => {
    for (const v of ["=1+1", "+cmd", "-2", "@SUM(A1)"]) expect(csvCell(v)).toBe(`"'${v}"`);
    expect(csvCell("plain")).toBe('"plain"');
  });
});

describe("past event date", () => {
  const now = new Date("2026-11-24T23:30:00Z");
  it("today (London) or earlier, from 1990", () => {
    expect(pastEventDateOk("2026-11-24", now)).toBe(true);
    expect(pastEventDateOk("2026-11-25", now)).toBe(false);
    expect(pastEventDateOk("1989-12-31", now)).toBe(false);
    expect(pastEventDateOk("2026-02-30", now)).toBe(false);
    expect(
      validatePastEvent({ title: "", date: "2027-01-01", branchId: null, photos: 13 }, true, now),
    ).toEqual({
      title: "events.fieldRequired",
      date: "pastEvents.dateError",
      branch: "events.fieldRequired",
      photos: "pastEvents.tooManyPhotos",
    });
  });
});
