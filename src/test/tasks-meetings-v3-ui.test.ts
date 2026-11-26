import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";
import { meetingTimeline } from "@/lib/meetings";
import { mergeLinkedTasks } from "@/lib/tasks";
import { isSubmitEnter } from "@/lib/enter-submit";
import { initials } from "@/components/tasks/task-display";

const at = (id: string, day: number) => ({
  id,
  starts_at: `2026-11-${String(day).padStart(2, "0")}T18:00:00+00:00`,
});

describe("meetings timeline", () => {
  it("orders oldest first: earlier past, the two most recent past, the next three, then later upcoming", () => {
    const past = [at("p5", 20), at("p4", 18), at("p3", 15), at("p2", 10), at("p1", 3)]; // latest first
    const upcoming = [at("u1", 27), at("u2", 28), at("u3", 29), at("u4", 30), at("u5", 30)];
    const line = meetingTimeline(upcoming, past);
    expect(line.earlier.map((m) => m.id)).toEqual(["p1", "p2", "p3"]);
    expect(line.recent.map((m) => m.id)).toEqual(["p4", "p5"]);
    expect(line.next.map((m) => m.id)).toEqual(["u1", "u2", "u3"]);
    expect(line.later.map((m) => m.id)).toEqual(["u4", "u5"]);
  });

  it("handles short lists without empty collapsed parts", () => {
    const line = meetingTimeline([at("u1", 27)], [at("p1", 3)]);
    expect(line.earlier).toEqual([]);
    expect(line.recent.map((m) => m.id)).toEqual(["p1"]);
    expect(line.next.map((m) => m.id)).toEqual(["u1"]);
    expect(line.later).toEqual([]);
    expect(meetingTimeline([], [])).toEqual({ earlier: [], recent: [], next: [], later: [] });
  });
});

describe("event linked tasks with a meeting's decision tasks", () => {
  it("lists each task once, by due date with undated ones last", () => {
    const merged = mergeLinkedTasks(
      [
        { id: "a", due_date: "2026-12-05" },
        { id: "b", due_date: null },
      ],
      [
        { id: "c", due_date: "2026-12-01" },
        { id: "a", due_date: "2026-12-05" },
        { id: "d", due_date: null },
      ],
    );
    expect(merged.map((t) => t.id)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("Enter saves, Shift+Enter is a new line", () => {
  it("submits on a plain Enter only", () => {
    expect(isSubmitEnter({ key: "Enter", shiftKey: false })).toBe(true);
    expect(isSubmitEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isSubmitEnter({ key: "a", shiftKey: false })).toBe(false);
  });
  it("ignores Enter while an input method is composing", () => {
    expect(
      isSubmitEnter({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } }),
    ).toBe(false);
    expect(isSubmitEnter({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
  });
});

describe("assignee initials", () => {
  it("uses the first and last name", () => {
    expect(initials("Ayşe Nur Yılmaz")).toBe("AY");
    expect(initials("ömer")).toBe("Ö");
    expect(initials(null)).toBe("?");
    expect(initials("  ")).toBe("?");
  });
});

describe("new strings exist in both languages", () => {
  const get = (o: unknown, key: string) =>
    key.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
  it.each([
    "common.enterToSave",
    "tasks.mine",
    "tasks.mineHint",
    "tasks.links.meeting",
    "tasks.links.event",
    "meetings.empty",
    "meetings.timeline.showEarlier",
    "meetings.timeline.hideEarlier",
    "meetings.timeline.recent",
    "meetings.timeline.next",
    "meetings.timeline.showLater",
    "meetings.timeline.hideLater",
    "meetings.decisions.editTask",
    "meetings.decisions.deleteTask",
    "meetings.decisions.deleteTaskText",
    "events.meetingDetails",
  ])("%s", (key) => {
    expect(typeof get(en, key)).toBe("string");
    expect(typeof get(tr, key)).toBe("string");
  });
});
