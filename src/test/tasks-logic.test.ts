import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FILTERS,
  DEFAULT_REMINDERS,
  NO_REMINDERS,
  archivableDoneIds,
  buildReminders,
  isSingleScope,
  reminderDraft,
  reminderSummary,
  defaultMineFilter,
  filterTasks,
  groupTasks,
  insertMention,
  mineFirst,
  typedMentionTrigger,
  visibleEventTasks,
  isDueSoon,
  isOverdue,
  readTaskView,
  saveTaskView,
  sortTasks,
  validateReminders,
  type Task,
} from "@/lib/tasks";

const TODAY = "2026-11-23";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ann = { id: id(101), full_name: "Ann" };
const bob = { id: id(102), full_name: "Bob" };
const branchA = id(201);

function task(n: number, over: Partial<Task> = {}): Task {
  return {
    id: id(n),
    scope: "branch",
    branch_id: branchA,
    region_id: null,
    branch: "Branch A",
    region: null,
    title: `Task ${n}`,
    description: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    self_task: false,
    created_by: null,
    created_by_name: null,
    event_id: null,
    meeting_id: null,
    decision_id: null,
    created_at: "2026-11-01T10:00:00Z",
    archived_at: null,
    note_count: 0,
    assignees: [],
    mine: false,
    can_edit: false,
    can_set_status: false,
    ...over,
  };
}

const tasks = [
  task(1, {
    mine: true,
    status: "in_progress",
    priority: "urgent",
    due_date: "2026-11-20",
    assignees: [ann],
  }),
  task(2, { status: "done", priority: "low", due_date: "2026-11-10", assignees: [ann, bob] }),
  task(3, {
    priority: "high",
    due_date: "2026-11-27",
    branch_id: null,
    branch: null,
    scope: "national",
  }),
  task(4, { mine: true, title: "Alpha", assignees: [bob] }),
  task(5, { due_date: "2026-12-15" }),
];
const ids = (list: Task[]) => list.map((t) => Number(t.id.slice(-3)));

describe("filterTasks", () => {
  it("keeps everything with the default filters", () => {
    expect(filterTasks(tasks, DEFAULT_FILTERS, TODAY)).toHaveLength(5);
  });
  it("filters by mine, status, priority, assignee and branch", () => {
    expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, mine: true }, TODAY))).toEqual([1, 4]);
    expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, status: "done" }, TODAY))).toEqual([2]);
    expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, priority: "high" }, TODAY))).toEqual([3]);
    expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, assignee: bob.id }, TODAY))).toEqual([
      2, 4,
    ]);
    expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, branch: "none" }, TODAY))).toEqual([3]);
    expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, branch: branchA }, TODAY))).toEqual([
      1, 2, 4, 5,
    ]);
  });
  it("filters by due: overdue (not done), this week and no date", () => {
    expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, due: "overdue" }, TODAY))).toEqual([1]);
    expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, due: "week" }, TODAY))).toEqual([3]);
    expect(ids(filterTasks(tasks, { ...DEFAULT_FILTERS, due: "none" }, TODAY))).toEqual([4]);
  });
  it("combines filters", () => {
    expect(
      ids(filterTasks(tasks, { ...DEFAULT_FILTERS, mine: true, assignee: ann.id }, TODAY)),
    ).toEqual([1]);
  });
});

describe("archived tasks", () => {
  const withArchived = [...tasks, task(6, { status: "done", archived_at: "2026-11-22T10:00:00Z" })];
  it("hides archived tasks by default and shows only them with the Archived filter", () => {
    expect(ids(filterTasks(withArchived, DEFAULT_FILTERS, TODAY))).not.toContain(6);
    expect(ids(filterTasks(withArchived, { ...DEFAULT_FILTERS, archived: true }, TODAY))).toEqual([
      6,
    ]);
  });
  it("archives only shown done tasks that are not archived and that the caller may change", () => {
    const list = [
      task(7, { status: "done", can_set_status: true }),
      task(8, { status: "done", can_set_status: false }),
      task(9, { status: "todo", can_set_status: true }),
      task(10, { status: "done", can_set_status: true, archived_at: "2026-11-22T10:00:00Z" }),
    ];
    expect(archivableDoneIds(list).map((x) => Number(x.slice(-3)))).toEqual([7]);
  });
  it("shows an event's archived tasks only when nothing else is linked", () => {
    const a = { id: "a", archived_at: null };
    const b = { id: "b", archived_at: "2026-11-22T10:00:00Z" };
    expect(visibleEventTasks([a, b])).toEqual([a]);
    expect(visibleEventTasks([b])).toEqual([b]);
    expect(visibleEventTasks([])).toEqual([]);
  });
});

describe("my tasks", () => {
  it("starts on 'My tasks' only for someone with a (not archived) task assigned", () => {
    expect(defaultMineFilter(tasks)).toBe(true);
    expect(defaultMineFilter(tasks.map((x) => ({ ...x, mine: false })))).toBe(false);
    expect(defaultMineFilter([task(1, { mine: true, archived_at: "2026-11-22T10:00:00Z" })])).toBe(
      false,
    );
  });
  it("puts my tasks first and keeps the order inside each part", () => {
    expect(ids(mineFirst(tasks))).toEqual([1, 4, 2, 3, 5]);
  });
  it("groups by mine first, then the others", () => {
    const groups = groupTasks(tasks, "mine", "Unassigned");
    expect(groups.map((g) => g.key)).toEqual(["mine", "others"]);
    expect(ids(groups[0]!.tasks)).toEqual([1, 4]);
    expect(groupTasks([tasks[1]!], "mine", "Unassigned").map((g) => g.key)).toEqual(["others"]);
  });
});

describe("note mentions", () => {
  it("detects a typed @ just before the caret", () => {
    expect(typedMentionTrigger("Hi ", "Hi @", 4)).toBe(true);
    expect(typedMentionTrigger("Hi", "Hi!", 3)).toBe(false);
    expect(typedMentionTrigger("", "@@", 2)).toBe(false);
    expect(typedMentionTrigger("ab", "a@b", 2)).toBe(true);
  });
  it("replaces the @ that opened the picker", () => {
    expect(insertMention("Hi @", 4, "Ann Lee")).toEqual({ body: "Hi @Ann Lee ", caret: 12 });
    expect(insertMention("@ there", 1, "Bob")).toEqual({ body: "@Bob  there", caret: 5 });
  });
  it("adds the mention at the caret with a space before it when needed", () => {
    expect(insertMention("Please check", 12, "Ann")).toEqual({
      body: "Please check @Ann ",
      caret: 18,
    });
    expect(insertMention("", 0, "Ann")).toEqual({ body: "@Ann ", caret: 5 });
  });
});

describe("sortTasks", () => {
  it("sorts by due date with undated tasks last", () => {
    expect(ids(sortTasks(tasks, "due"))).toEqual([2, 1, 3, 5, 4]);
  });
  it("sorts by priority, title and status, ties by due date", () => {
    expect(ids(sortTasks(tasks, "priority"))).toEqual([1, 3, 5, 4, 2]);
    expect(ids(sortTasks(tasks, "title"))[0]).toBe(4);
    expect(ids(sortTasks(tasks, "status"))).toEqual([3, 5, 4, 1, 2]);
  });
  it("does not change the input", () => {
    const copy = [...tasks];
    sortTasks(tasks, "title");
    expect(tasks).toEqual(copy);
  });
});

describe("groupTasks", () => {
  it("returns one group without grouping", () => {
    expect(groupTasks(tasks, "none", "Unassigned")).toEqual([{ key: "all", label: "", tasks }]);
  });
  it("groups by status in status order and skips empty groups", () => {
    const groups = groupTasks(tasks, "status", "Unassigned");
    expect(groups.map((g) => g.key)).toEqual(["todo", "in_progress", "done"]);
    expect(ids(groups[0]!.tasks)).toEqual([3, 4, 5]);
  });
  it("puts a task with several assignees under each of them, unassigned last", () => {
    const groups = groupTasks(tasks, "assignee", "Unassigned");
    expect(groups.map((g) => g.label)).toEqual(["Ann", "Bob", "Unassigned"]);
    expect(ids(groups[0]!.tasks)).toEqual([1, 2]);
    expect(ids(groups[1]!.tasks)).toEqual([2, 4]);
    expect(groups[2]!.key).toBe("none");
    expect(ids(groups[2]!.tasks)).toEqual([3, 5]);
  });
});

describe("validateReminders", () => {
  it("accepts the defaults and valid settings", () => {
    expect(validateReminders(DEFAULT_REMINDERS)).toEqual({});
    expect(
      validateReminders({
        before_days: [1, 3, 7, 14],
        repeat_kind: "every_n",
        repeat_every_days: 5,
        repeat_start: TODAY,
        overdue_every_days: 2,
      }),
    ).toEqual({});
  });
  it("rejects invalid before days", () => {
    expect(validateReminders({ ...DEFAULT_REMINDERS, before_days: [0] }).before_days).toBe(
      "tasks.errors.beforeDays",
    );
    expect(validateReminders({ ...DEFAULT_REMINDERS, before_days: [366] }).before_days).toBe(
      "tasks.errors.beforeDays",
    );
    expect(validateReminders({ ...DEFAULT_REMINDERS, before_days: [Number.NaN] }).before_days).toBe(
      "tasks.errors.beforeDays",
    );
    expect(
      validateReminders({ ...DEFAULT_REMINDERS, before_days: [1, 2, 3, 4, 5, 6, 7] }).before_days,
    ).toBe("tasks.errors.beforeDays");
  });
  it("requires 2 to 90 days for every-N repeats only", () => {
    const everyN = { ...DEFAULT_REMINDERS, repeat_kind: "every_n" as const };
    expect(validateReminders({ ...everyN, repeat_every_days: null }).repeat_every_days).toBe(
      "tasks.errors.repeatEvery",
    );
    expect(validateReminders({ ...everyN, repeat_every_days: 1 }).repeat_every_days).toBe(
      "tasks.errors.repeatEvery",
    );
    expect(validateReminders({ ...everyN, repeat_every_days: 91 }).repeat_every_days).toBe(
      "tasks.errors.repeatEvery",
    );
    expect(validateReminders({ ...DEFAULT_REMINDERS, repeat_kind: "weekly" })).toEqual({});
  });
  it("checks overdue reminders only when on", () => {
    expect(
      validateReminders({ ...DEFAULT_REMINDERS, overdue_every_days: 0 }).overdue_every_days,
    ).toBe("tasks.errors.overdueEvery");
    expect(
      validateReminders({ ...DEFAULT_REMINDERS, overdue_every_days: 1.5 }).overdue_every_days,
    ).toBe("tasks.errors.overdueEvery");
    expect(validateReminders({ ...DEFAULT_REMINDERS, overdue_every_days: 90 })).toEqual({});
  });
});

describe("isOverdue / isDueSoon", () => {
  it("is overdue only before today and when not done", () => {
    expect(isOverdue({ due_date: "2026-11-22", status: "todo" }, TODAY)).toBe(true);
    expect(isOverdue({ due_date: TODAY, status: "todo" }, TODAY)).toBe(false);
    expect(isOverdue({ due_date: "2026-11-22", status: "done" }, TODAY)).toBe(false);
    expect(isOverdue({ due_date: null, status: "todo" }, TODAY)).toBe(false);
  });
  it("is due soon today or tomorrow when not done", () => {
    expect(isDueSoon({ due_date: TODAY, status: "blocked" }, TODAY)).toBe(true);
    expect(isDueSoon({ due_date: "2026-11-24", status: "todo" }, TODAY)).toBe(true);
    expect(isDueSoon({ due_date: "2026-11-25", status: "todo" }, TODAY)).toBe(false);
    expect(isDueSoon({ due_date: "2026-11-22", status: "todo" }, TODAY)).toBe(false);
    expect(isDueSoon({ due_date: TODAY, status: "done" }, TODAY)).toBe(false);
  });
  it("crosses month ends", () => {
    expect(isDueSoon({ due_date: "2026-12-01", status: "todo" }, "2026-11-30")).toBe(true);
  });
});

describe("readTaskView / saveTaskView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  it("remembers the view per user and defaults to kanban", () => {
    expect(readTaskView("u1")).toBe("kanban");
    saveTaskView("u1", "calendar");
    expect(readTaskView("u1")).toBe("calendar");
    expect(readTaskView("u2")).toBe("kanban");
    expect(readTaskView(undefined)).toBe("kanban");
  });
  it("ignores unknown stored values", () => {
    localStorage.setItem("dsvh-tasks-view:u1", "table");
    expect(readTaskView("u1")).toBe("kanban");
  });
  it("falls back to kanban when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveTaskView("u1", "list")).not.toThrow();
    expect(readTaskView("u1")).toBe("kanban");
  });
});

describe("reminder drafts (task form and My reminders)", () => {
  it("round-trips settings through the inputs, with a custom day", () => {
    const settings = {
      before_days: [3, 10],
      repeat_kind: "every_n" as const,
      repeat_every_days: 4,
      repeat_start: "2026-11-25",
      overdue_every_days: 2,
    };
    const draft = reminderDraft(settings, TODAY);
    expect(draft).toEqual({
      before: [3],
      custom: "10",
      kind: "every_n",
      every: "4",
      start: "2026-11-25",
      overdueOn: true,
      overdueEvery: "2",
    });
    expect(buildReminders(draft, TODAY)).toEqual(settings);
  });
  it("starts My reminders from 3 days before, and drops repeat fields when repeat is off", () => {
    const draft = reminderDraft(DEFAULT_REMINDERS, TODAY);
    expect(buildReminders(draft, TODAY)).toEqual(DEFAULT_REMINDERS);
    expect(buildReminders({ ...draft, kind: "daily", every: "9" }, TODAY)).toMatchObject({
      repeat_kind: "daily",
      repeat_every_days: null,
      repeat_start: TODAY,
    });
    expect(buildReminders({ ...draft, before: [] }, TODAY)).toEqual(NO_REMINDERS);
  });
  it("keeps invalid numbers for validation", () => {
    const r = buildReminders(
      { ...reminderDraft(DEFAULT_REMINDERS, TODAY), kind: "every_n", every: "1" },
      TODAY,
    );
    expect(validateReminders(r).repeat_every_days).toBe("tasks.errors.repeatEvery");
  });
  it("summarises settings as i18n keys", () => {
    expect(reminderSummary(NO_REMINDERS)).toEqual([{ key: "tasks.reminders.noBefore" }]);
    expect(
      reminderSummary({
        before_days: [1, 7],
        repeat_kind: "weekly",
        repeat_every_days: null,
        repeat_start: "2026-11-25",
        overdue_every_days: 3,
      }),
    ).toEqual([
      { key: "tasks.reminders.before", params: { days: "1, 7" } },
      { key: "tasks.reminders.weekly" },
      { key: "tasks.reminders.startingOn", date: "2026-11-25" },
      { key: "tasks.reminders.overdue", params: { count: 3 } },
    ]);
  });
});

describe("isSingleScope", () => {
  it("is true only for exactly one place to work in", () => {
    expect(isSingleScope([{ scope: "branch" }])).toBe(true);
    expect(isSingleScope([])).toBe(false);
    expect(isSingleScope(undefined)).toBe(false);
    expect(isSingleScope([{ scope: "region" }, { scope: "branch" }])).toBe(false);
  });
});
