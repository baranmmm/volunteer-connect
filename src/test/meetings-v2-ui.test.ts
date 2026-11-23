import { describe, expect, it } from "vitest";
import {
  filterSeriesTasks,
  meetingRecurrenceError,
  parseStandingAgenda,
} from "@/components/meetings/meeting-ui";
import type { MeetingSeriesTask } from "@/lib/meetings";

describe("meeting form repetition", () => {
  const start = "2026-12-01T18:00:00Z";
  it("accepts 1-4 weeks or months apart and 2-52 meetings within 12 months", () => {
    expect(meetingRecurrenceError(start, { freq: "weekly", interval: 1, count: 3 })).toBeNull();
    expect(meetingRecurrenceError(start, { freq: "weekly", interval: 1, count: 52 })).toBeNull();
    expect(meetingRecurrenceError(start, { freq: "monthly", interval: 1, count: 13 })).toBeNull();
    expect(meetingRecurrenceError(start, { freq: "monthly", interval: 4, count: 4 })).toBeNull();
  });
  it("refuses other settings with an i18n key", () => {
    expect(meetingRecurrenceError(start, { freq: "weekly", interval: 0, count: 3 })).toBe(
      "meetings.repeat.errors.interval",
    );
    expect(meetingRecurrenceError(start, { freq: "weekly", interval: 5, count: 3 })).toBe(
      "meetings.repeat.errors.interval",
    );
    expect(meetingRecurrenceError(start, { freq: "weekly", interval: 1, count: 1 })).toBe(
      "meetings.repeat.errors.count",
    );
    expect(meetingRecurrenceError(start, { freq: "weekly", interval: 1, count: 53 })).toBe(
      "meetings.repeat.errors.count",
    );
    expect(meetingRecurrenceError(start, { freq: "weekly", interval: 1, count: Number.NaN })).toBe(
      "meetings.repeat.errors.count",
    );
    expect(meetingRecurrenceError(start, { freq: "monthly", interval: 1, count: 14 })).toBe(
      "meetings.repeat.errors.tooLong",
    );
    expect(meetingRecurrenceError(start, { freq: "weekly", interval: 2, count: 30 })).toBe(
      "meetings.repeat.errors.tooLong",
    );
  });
  it("counts London calendar days, so a late-evening start keeps its day", () => {
    // 23:30 London on 31 Jan (UTC): 12 monthly steps end on 31 Jan next year, still inside the limit.
    expect(
      meetingRecurrenceError("2027-01-31T23:30:00Z", { freq: "monthly", interval: 1, count: 13 }),
    ).toBeNull();
  });
});

describe("series tasks and standing agenda", () => {
  const task = (id: string, status: MeetingSeriesTask["status"]): MeetingSeriesTask => ({
    id,
    title: id,
    status,
    due_date: null,
    assignees: [],
    meeting_id: "00000000-0000-4000-8000-000000000001",
    meeting_starts_at: "2026-12-01T18:00:00Z",
  });
  const tasks = [task("a", "todo"), task("b", "done"), task("c", "blocked")];
  it("filters by status; open is everything not done", () => {
    expect(filterSeriesTasks(tasks, "open").map((x) => x.id)).toEqual(["a", "c"]);
    expect(filterSeriesTasks(tasks, "all").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(filterSeriesTasks(tasks, "done").map((x) => x.id)).toEqual(["b"]);
  });
  it("reads one standing item per line, trimmed, without blanks or repeats", () => {
    expect(parseStandingAgenda("  Finance \n\nEvents\nfinance\n" + "x".repeat(250))).toEqual([
      "Finance",
      "Events",
      "x".repeat(200),
    ]);
  });
});
