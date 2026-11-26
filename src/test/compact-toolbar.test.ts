import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_GROUPING,
  DEFAULT_TASK_ROW_SORT,
  calendarToolbarChanges,
  countChanged,
  taskToolbarChanges,
} from "@/lib/compact-toolbar";
import { readTaskGrouping, readTaskRowSort } from "@/lib/task-grouping";
import { DEFAULT_FILTERS } from "@/lib/tasks";

describe("countChanged", () => {
  it("counts the settings that differ from their defaults", () => {
    expect(countChanged([])).toBe(0);
    expect(
      countChanged([
        ["a", "a"],
        [true, false],
        [0, 0],
      ]),
    ).toBe(1);
  });
  it("compares arrays by their items in any order", () => {
    expect(countChanged([[[], []]])).toBe(0);
    expect(
      countChanged([
        [
          ["x", "y"],
          ["y", "x"],
        ],
      ]),
    ).toBe(0);
    expect(countChanged([[["x"], []]])).toBe(1);
    expect(countChanged([[["x"], ["x", "y"]]])).toBe(1);
  });
});

describe("taskToolbarChanges", () => {
  const base = {
    view: "list" as const,
    grouping: DEFAULT_TASK_GROUPING,
    sort: DEFAULT_TASK_ROW_SORT,
    filters: DEFAULT_FILTERS,
    regions: [] as string[],
    branches: [] as string[],
  };

  it("uses the page's defaults (Group by Meeting, Sort Status, everything else off)", () => {
    expect(DEFAULT_TASK_GROUPING).toBe(readTaskGrouping(undefined));
    expect(DEFAULT_TASK_ROW_SORT).toBe(readTaskRowSort(undefined));
    expect(taskToolbarChanges(base)).toBe(0);
    expect(taskToolbarChanges({ ...base, filters: { ...DEFAULT_FILTERS, archived: false } })).toBe(
      0,
    );
  });

  it("counts Group by, Sort, My tasks and Archived", () => {
    expect(taskToolbarChanges({ ...base, grouping: "due" })).toBe(1);
    expect(taskToolbarChanges({ ...base, grouping: "none", sort: "newest" })).toBe(2);
    expect(
      taskToolbarChanges({
        ...base,
        grouping: "assignee",
        sort: "due",
        filters: { ...DEFAULT_FILTERS, mine: true, archived: true },
      }),
    ).toBe(4);
  });

  it("counts the List filters only in the List view", () => {
    const filters = { ...DEFAULT_FILTERS, status: "done" as const, due: "overdue" as const };
    expect(taskToolbarChanges({ ...base, filters })).toBe(2);
    expect(taskToolbarChanges({ ...base, view: "kanban", filters })).toBe(0);
  });

  it("ignores Group by and Sort in the Calendar view (they are not offered there)", () => {
    expect(taskToolbarChanges({ ...base, view: "calendar", grouping: "due", sort: "oldest" })).toBe(
      0,
    );
    expect(
      taskToolbarChanges({
        ...base,
        view: "calendar",
        filters: { ...DEFAULT_FILTERS, mine: true },
      }),
    ).toBe(1);
  });

  it("counts a branch or region choice once each", () => {
    expect(taskToolbarChanges({ ...base, branches: ["a", "b"] })).toBe(1);
    expect(taskToolbarChanges({ ...base, branches: ["a"], regions: ["r"] })).toBe(2);
  });
});

describe("calendarToolbarChanges", () => {
  const base = {
    view: "list" as const,
    past: false,
    publicOnly: false as boolean | null,
    branchScope: "followed" as const,
    defaultBranchScope: "followed" as const,
    category: "all",
    organizer: "all",
  };

  it("is zero at the defaults (National Coordinators default to every branch)", () => {
    expect(calendarToolbarChanges(base)).toBe(0);
    expect(calendarToolbarChanges({ ...base, branchScope: "all", defaultBranchScope: "all" })).toBe(
      0,
    );
  });

  it("counts every changed filter", () => {
    expect(
      calendarToolbarChanges({
        ...base,
        past: true,
        publicOnly: true,
        branchScope: "all",
        category: "talk",
        organizer: "X",
      }),
    ).toBe(5);
  });

  it("ignores Past in the Month view and Public only where it is not offered", () => {
    expect(calendarToolbarChanges({ ...base, view: "month", past: true })).toBe(0);
    expect(calendarToolbarChanges({ ...base, publicOnly: null })).toBe(0);
  });
});
