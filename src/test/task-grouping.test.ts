import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";
import { collapseGroups, type Task, type TaskGroupData } from "@/lib/tasks";
import {
  DUE_BUCKETS,
  TASK_GROUPINGS,
  TASK_ROW_SORTS,
  compareTasks,
  createdDateOptions,
  decisionTexts,
  dueBucket,
  formatCreatedDate,
  groupTaskSections,
  isCollapsed,
  readCollapsed,
  readTaskGrouping,
  readTaskRowSort,
  saveCollapsed,
  saveTaskGrouping,
  saveTaskRowSort,
  sectionKeys,
  setAllCollapsed,
  sortTaskRows,
  sourceDay,
  taskPlace,
  weekStart,
  type TaskSources,
} from "@/lib/task-grouping";

// The Tasks page's "Group by": meeting (meeting > agenda item > tasks, then Events > event, then Other tasks),
// assignee, due date, none; done/total, the default collapse (only the newest meeting open, all-done sections closed),
// Expand/Collapse all, the Sort inside sections, the created date, and the remembered choices.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = (n: number, extra: Partial<Task> = {}): Task => ({
  id: uuid(n),
  scope: "branch",
  branch_id: uuid(900),
  region_id: uuid(901),
  branch: "One",
  region: "Region",
  title: `Task ${n}`,
  description: null,
  status: "todo",
  priority: "medium",
  due_date: null,
  self_task: false,
  created_by: uuid(800),
  created_by_name: "Manager",
  event_id: null,
  meeting_id: null,
  decision_id: null,
  created_at: "2026-11-26T10:00:00Z",
  archived_at: null,
  group_id: null,
  note_count: 0,
  assignees: [],
  mine: false,
  can_edit: true,
  can_set_status: true,
  ...extra,
});
const LABELS = {
  other: "Other",
  events: "Events",
  unassigned: "Unassigned",
  allMembers: "All members",
  formerMember: "Former",
};
const TODAY = "2026-11-26"; // a Thursday

const M_OLD = uuid(301),
  M_NEW = uuid(302),
  ITEM_A = uuid(401),
  ITEM_B = uuid(402),
  ITEM_OLD = uuid(403),
  EVENT = uuid(601),
  HIDDEN_EVENT = uuid(602);
const SOURCES: TaskSources = {
  decisions: [
    // Ordered like the server: meeting date, then agenda position.
    {
      id: uuid(201),
      agenda_item_id: ITEM_OLD,
      agenda_item: "Budget",
      meeting_id: M_OLD,
      meeting: "October committee",
      starts_at: "2026-10-01T17:00:00Z",
      text: "Approve the budget",
    },
    {
      id: uuid(202),
      agenda_item_id: ITEM_A,
      agenda_item: "Iftar plan",
      meeting_id: M_NEW,
      meeting: "November committee",
      starts_at: "2026-11-20T18:00:00Z",
    },
    {
      id: uuid(203),
      agenda_item_id: ITEM_A,
      agenda_item: "Iftar plan",
      meeting_id: M_NEW,
      meeting: "November committee",
      starts_at: "2026-11-20T18:00:00Z",
    },
    {
      id: uuid(204),
      agenda_item_id: ITEM_B,
      agenda_item: "Volunteers",
      meeting_id: M_NEW,
      meeting: "November committee",
      starts_at: "2026-11-20T18:00:00Z",
    },
  ],
  meetings: [
    { id: M_OLD, title: "October committee", starts_at: "2026-10-01T17:00:00Z" },
    { id: M_NEW, title: "November committee", starts_at: "2026-11-20T18:00:00Z" },
  ],
  events: [{ id: EVENT, title: "Winter dinner", start: "2026-12-12" }],
};

describe("meeting hierarchy", () => {
  it("meetings newest first > agenda items in agenda order > tasks; then Events > event; then Other tasks", () => {
    const tasks = [
      task(1, { event_id: EVENT }),
      task(2, { decision_id: uuid(204), meeting_id: M_NEW }),
      task(3, { decision_id: uuid(202), meeting_id: M_NEW, status: "done" }),
      task(4, { decision_id: uuid(203), meeting_id: M_NEW }),
      task(5),
      task(6, { decision_id: uuid(201), meeting_id: M_OLD }),
      task(7, { meeting_id: M_OLD }),
    ];
    const s = groupTaskSections(tasks, "meeting", SOURCES, TODAY, LABELS);
    expect(s.map((x) => x.key)).toEqual([
      `meeting:${M_NEW}`,
      `meeting:${M_OLD}`,
      "events",
      "other",
    ]);
    const nov = s[0]!;
    expect(nov).toMatchObject({
      kind: "meeting",
      title: "November committee",
      date: "2026-11-20",
      newest: true,
      done: 1,
      total: 3,
    });
    expect(nov.children.map((x) => x.key)).toEqual([`agenda:${ITEM_A}`, `agenda:${ITEM_B}`]);
    expect(nov.children[0]).toMatchObject({
      kind: "agenda",
      title: "Iftar plan",
      done: 1,
      total: 2,
    });
    // Sorted by status (To do first), the done task last.
    expect(nov.children[0]!.tasks.map((x) => x.id)).toEqual([uuid(4), uuid(3)]);
    expect(nov.tasks).toEqual([]);
    // A meeting's task from no agenda item sits directly under the meeting, after its agenda items.
    const oct = s[1]!;
    expect(oct.newest).toBe(false);
    expect(oct.children.map((x) => x.key)).toEqual([`agenda:${ITEM_OLD}`]);
    expect(oct.tasks.map((x) => x.id)).toEqual([uuid(7)]);
    expect(oct).toMatchObject({ done: 0, total: 2 });
    const events = s[2]!;
    expect(events).toMatchObject({ kind: "events", title: "Events", total: 1 });
    expect(events.children[0]).toMatchObject({
      key: `event:${EVENT}`,
      title: "Winter dinner",
      date: "2026-12-12",
    });
    expect(s.at(-1)).toMatchObject({ kind: "other", title: "Other", total: 1, children: [] });
    expect(sectionKeys(s)).toEqual([
      `meeting:${M_NEW}`,
      `agenda:${ITEM_A}`,
      `agenda:${ITEM_B}`,
      `meeting:${M_OLD}`,
      `agenda:${ITEM_OLD}`,
      "events",
      `event:${EVENT}`,
      "other",
    ]);
  });

  it("no meetings or events: only Other tasks (no empty Events section)", () => {
    const s = groupTaskSections([task(1)], "meeting", SOURCES, TODAY, LABELS);
    expect(s.map((x) => x.key)).toEqual(["other"]);
  });

  it("events newest first, undated last", () => {
    const sources: TaskSources = {
      ...SOURCES,
      events: [
        { id: uuid(611), title: "Old", start: "2026-01-10T18:00:00Z" },
        { id: uuid(612), title: "Undated", start: null },
        { id: uuid(613), title: "New", start: "2026-12-01" },
      ],
    };
    const s = groupTaskSections(
      [611, 612, 613].map((n) => task(n, { event_id: uuid(n) })),
      "meeting",
      sources,
      TODAY,
      LABELS,
    );
    expect(s[0]!.children.map((x) => x.title)).toEqual(["New", "Old", "Undated"]);
  });

  it("a source the caller may not see (no label from the server) falls back to Other tasks", () => {
    const t = task(1, { event_id: HIDDEN_EVENT, decision_id: uuid(299), meeting_id: uuid(399) });
    expect(taskPlace(t, SOURCES)).toEqual({ kind: "other" });
  });

  it("decision texts by decision id (missing texts are left out)", () => {
    const m = decisionTexts(SOURCES);
    expect(m.get(uuid(201))).toBe("Approve the budget");
    expect(m.has(uuid(202))).toBe(false);
  });

  it("an @all group is one row in its source group, counted once", () => {
    const g: TaskGroupData = {
      id: uuid(500),
      scope: "branch",
      branch_id: uuid(900),
      region_id: uuid(901),
      branch: "One",
      region: "Region",
      title: "Bring a friend",
      description: null,
      priority: "medium",
      due_date: "2026-12-01",
      event_id: null,
      meeting_id: M_NEW,
      decision_id: uuid(204),
      created_by: uuid(800),
      created_by_name: "Manager",
      created_at: "2026-11-26T10:00:00Z",
      status: "in_progress",
      member_count: 2,
      counts: { todo: 1, in_progress: 0, blocked: 0, done: 1 },
      archived: false,
      members: [
        {
          task_id: uuid(11),
          user_id: uuid(101),
          full_name: "A",
          status: "done",
          archived_at: null,
        },
        {
          task_id: uuid(12),
          user_id: uuid(102),
          full_name: "B",
          status: "todo",
          archived_at: null,
        },
      ],
      mine: false,
      my_task_id: null,
      can_edit: true,
    };
    const members = [11, 12].map((n) =>
      task(n, {
        group_id: uuid(500),
        decision_id: uuid(204),
        meeting_id: M_NEW,
        assignees: [{ id: uuid(90 + n), full_name: `M${n}` }],
      }),
    );
    const rows = collapseGroups(members, [g]);
    const s = groupTaskSections(rows, "meeting", SOURCES, TODAY, LABELS);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ key: `meeting:${M_NEW}`, total: 1, done: 0 });
    expect(s[0]!.children[0]).toMatchObject({ key: `agenda:${ITEM_B}`, total: 1, done: 0 });
    expect(s[0]!.children[0]!.tasks[0]!.group?.id).toBe(uuid(500));
    // By assignee, the group row sits under "All members", not under each member.
    const a = groupTaskSections(rows, "assignee", SOURCES, TODAY, LABELS);
    expect(a.map((x) => x.kind)).toEqual(["allMembers"]);
  });
});

describe("assignee, due and none", () => {
  it("assignee: people by name (a shared task under each), then Unassigned", () => {
    const zed = { id: uuid(71), full_name: "Zed" },
      amy = { id: uuid(72), full_name: "Amy" };
    const s = groupTaskSections(
      [task(1, { assignees: [zed, amy] }), task(2, { assignees: [zed] }), task(3)],
      "assignee",
      SOURCES,
      TODAY,
      LABELS,
    );
    expect(s.map((x) => [x.title, x.total])).toEqual([
      ["Amy", 1],
      ["Zed", 2],
      ["Unassigned", 1],
    ]);
  });

  it("due buckets around a London week (Monday to Sunday)", () => {
    expect(weekStart(TODAY)).toBe("2026-11-23");
    const b = (due: string | null, status: Task["status"] = "todo") =>
      dueBucket({ due_date: due, status }, TODAY);
    expect(b("2026-11-25")).toBe("overdue");
    expect(b("2026-11-25", "done")).toBe("thisWeek");
    expect(b("2026-11-10", "done")).toBe("earlier");
    expect(b(TODAY)).toBe("thisWeek");
    expect(b("2026-11-29")).toBe("thisWeek");
    expect(b("2026-11-30")).toBe("nextWeek");
    expect(b("2026-12-06")).toBe("nextWeek");
    expect(b("2026-12-07")).toBe("later");
    expect(b(null)).toBe("none");
  });

  it("due sections come in a fixed order and skip empty ones", () => {
    const s = groupTaskSections(
      [task(1, { due_date: "2026-12-20" }), task(2), task(3, { due_date: "2026-11-01" })],
      "due",
      SOURCES,
      TODAY,
      LABELS,
    );
    expect(s.map((x) => x.title)).toEqual(["overdue", "later", "none"]);
    expect(DUE_BUCKETS).toEqual(["overdue", "thisWeek", "nextWeek", "later", "earlier", "none"]);
  });

  it("none: one section with every task; no tasks: no sections", () => {
    const s = groupTaskSections(
      [task(1), task(2, { status: "done" })],
      "none",
      SOURCES,
      TODAY,
      LABELS,
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ key: "all", done: 1, total: 2 });
    expect(groupTaskSections([], "meeting", SOURCES, TODAY, LABELS)).toEqual([]);
  });

  it("source dates are London days (an evening meeting after midnight UTC stays on its London day)", () => {
    expect(sourceDay("2026-06-30T23:30:00Z")).toBe("2026-07-01");
    expect(sourceDay("2026-12-12")).toBe("2026-12-12");
    expect(sourceDay(null)).toBeNull();
  });
});

describe("collapsed sections", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  it("all done collapses by default; the user's own choice wins either way", () => {
    expect(isCollapsed({ key: "a", done: 3, total: 3 }, {})).toBe(true);
    expect(isCollapsed({ key: "a", done: 2, total: 3 }, {})).toBe(false);
    expect(isCollapsed({ key: "a", done: 3, total: 3 }, { a: false })).toBe(false);
    expect(isCollapsed({ key: "a", done: 0, total: 3 }, { a: true })).toBe(true);
    // The Archived view (every task done) does not collapse on its own.
    expect(isCollapsed({ key: "a", done: 3, total: 3 }, {}, false)).toBe(false);
    expect(isCollapsed({ key: "a", done: 3, total: 3 }, { a: true }, false)).toBe(true);
  });
  it("only the newest meeting starts open; its agenda items open unless all done", () => {
    const s = groupTaskSections(
      [
        task(1, { decision_id: uuid(202), meeting_id: M_NEW }),
        task(2, { decision_id: uuid(204), meeting_id: M_NEW, status: "done" }),
        task(3, { meeting_id: M_OLD }),
      ],
      "meeting",
      SOURCES,
      TODAY,
      LABELS,
    );
    const [nov, oct] = s;
    expect(isCollapsed(nov!, {})).toBe(false);
    expect(isCollapsed(oct!, {})).toBe(true);
    expect(isCollapsed(nov!.children[0]!, {})).toBe(false);
    expect(isCollapsed(nov!.children[1]!, {})).toBe(true);
    // The user's choice wins (an older meeting opened, the newest closed).
    expect(isCollapsed(oct!, { [oct!.key]: false })).toBe(false);
    expect(isCollapsed(nov!, { [nov!.key]: true })).toBe(true);
  });
  it("Expand all / Collapse all set every section of the tree and keep other remembered keys", () => {
    const s = groupTaskSections(
      [task(1, { decision_id: uuid(202), meeting_id: M_NEW }), task(2)],
      "meeting",
      SOURCES,
      TODAY,
      LABELS,
    );
    const closed = setAllCollapsed({ "due:later": false, other: false }, s, true);
    expect(closed).toEqual({
      "due:later": false,
      other: true,
      [`meeting:${M_NEW}`]: true,
      [`agenda:${ITEM_A}`]: true,
    });
    const open = setAllCollapsed(closed, s, false);
    for (const k of sectionKeys(s))
      expect(isCollapsed({ key: k, done: 1, total: 1, kind: "meeting" }, open)).toBe(false);
  });
  it("remembers the grouping, sort and collapsed sections per user; defaults to Meeting/Status; survives blocked storage", () => {
    expect(readTaskGrouping("u1")).toBe("meeting");
    saveTaskGrouping("u1", "due");
    expect(readTaskGrouping("u1")).toBe("due");
    expect(readTaskGrouping("u2")).toBe("meeting");
    localStorage.setItem("dsvh-tasks-grouping:u3", "status");
    expect(readTaskGrouping("u3")).toBe("meeting");
    // The old "Source" choice becomes the Meeting grouping.
    localStorage.setItem("dsvh-tasks-grouping:u5", "source");
    expect(readTaskGrouping("u5")).toBe("meeting");
    expect(readTaskRowSort("u1")).toBe("status");
    saveTaskRowSort("u1", "newest");
    expect(readTaskRowSort("u1")).toBe("newest");
    expect(readTaskRowSort("u2")).toBe("status");
    saveCollapsed("u1", { "agenda:x": true, other: false });
    expect(readCollapsed("u1")).toEqual({ "agenda:x": true, other: false });
    expect(readCollapsed("u2")).toEqual({});
    localStorage.setItem("dsvh-tasks-collapsed:u4", "not json");
    expect(readCollapsed("u4")).toEqual({});
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveCollapsed("u1", { a: true })).not.toThrow();
    expect(readTaskGrouping("u1")).toBe("meeting");
    expect(readTaskRowSort("u1")).toBe("status");
    expect(() => saveTaskRowSort("u1", "due")).not.toThrow();
    expect(readCollapsed("u1")).toEqual({});
  });
  it("every grouping and due bucket has EN and TR labels", () => {
    for (const lang of [en, tr]) {
      const g = lang.tasks.grouping as { by: Record<string, string>; due: Record<string, string> };
      for (const x of TASK_GROUPINGS) expect(g.by[x]).toBeTruthy();
      for (const b of DUE_BUCKETS) expect(g.due[b]).toBeTruthy();
      const sorts = lang.tasks.filters.sortBy as Record<string, string>;
      for (const x of TASK_ROW_SORTS) expect(sorts[x]).toBeTruthy();
      for (const k of ["events", "expandAll", "collapseAll"])
        expect((lang.tasks.grouping as Record<string, unknown>)[k]).toBeTruthy();
      expect(lang.tasks.created).toContain("{{date}}");
      expect(lang.tasks.createdBy).toContain("{{name}}");
      expect(lang.tasks.decisionLine).toContain("{{text}}");
    }
  });
});

describe("sort inside sections", () => {
  const rows = [
    task(1, { status: "done", due_date: "2026-11-01", created_at: "2026-11-03T09:00:00Z" }),
    task(2, { status: "todo", due_date: null, created_at: "2026-11-05T09:00:00Z" }),
    task(3, { status: "blocked", due_date: "2026-11-20", created_at: "2026-11-01T09:00:00Z" }),
    task(4, { status: "todo", due_date: "2026-12-01", created_at: "2026-11-04T09:00:00Z" }),
    task(5, { status: "in_progress", due_date: "2026-11-28", created_at: "2026-11-02T09:00:00Z" }),
  ];
  const ids = (list: Task[]) => list.map((x) => Number(x.id.slice(-3)));
  it("Status: To do, In progress, Blocked, Done; then due date (no due date last)", () => {
    expect(ids(sortTaskRows(rows, "status"))).toEqual([4, 2, 5, 3, 1]);
  });
  it("Due date (no due date last), Newest first, Oldest first (created)", () => {
    expect(ids(sortTaskRows(rows, "due"))).toEqual([1, 3, 5, 4, 2]);
    expect(ids(sortTaskRows(rows, "newest"))).toEqual([2, 4, 1, 5, 3]);
    expect(ids(sortTaskRows(rows, "oldest"))).toEqual([3, 5, 1, 4, 2]);
  });
  it("ties fall back to the due date, then the title", () => {
    const a = task(8, { title: "B", due_date: "2026-12-02" });
    const b = task(9, { title: "A", due_date: "2026-12-02" });
    expect(compareTasks("status")(a, b)).toBeGreaterThan(0);
    expect(compareTasks("newest")(task(10, { due_date: "2026-12-01" }), a)).toBeLessThan(0);
  });
  it("applies at every level of the Meeting hierarchy and in the other groupings", () => {
    const tree = groupTaskSections(
      [
        task(1, { decision_id: uuid(202), meeting_id: M_NEW, created_at: "2026-11-01T00:00:00Z" }),
        task(2, { decision_id: uuid(202), meeting_id: M_NEW, created_at: "2026-11-09T00:00:00Z" }),
        task(3, { meeting_id: M_NEW, created_at: "2026-11-02T00:00:00Z" }),
        task(4, { meeting_id: M_NEW, created_at: "2026-11-08T00:00:00Z" }),
      ],
      "meeting",
      SOURCES,
      TODAY,
      LABELS,
      "newest",
    );
    expect(ids(tree[0]!.children[0]!.tasks)).toEqual([2, 1]);
    expect(ids(tree[0]!.tasks)).toEqual([4, 3]);
    const flat = groupTaskSections(rows, "none", SOURCES, TODAY, LABELS, "oldest");
    expect(ids(flat[0]!.tasks)).toEqual([3, 5, 1, 4, 2]);
  });
});

describe("created date", () => {
  it("omits the current (London) year and shows other years", () => {
    expect(createdDateOptions("2026-11-25T10:00:00Z", TODAY)).toEqual({
      day: "numeric",
      month: "short",
    });
    expect(createdDateOptions("2025-11-25T10:00:00Z", TODAY)).toMatchObject({ year: "numeric" });
    expect(formatCreatedDate("2026-11-25T10:00:00Z", TODAY, "en-GB")).toBe("25 Nov");
    expect(formatCreatedDate("2025-11-25T10:00:00Z", TODAY, "en-GB")).toBe("25 Nov 2025");
    expect(formatCreatedDate("2026-11-25T10:00:00Z", TODAY, "tr-TR")).toBe("25 Kas");
  });
  it("uses the London day (just after midnight in London in summer)", () => {
    expect(formatCreatedDate("2026-06-30T23:30:00Z", TODAY, "en-GB")).toBe("1 Jul");
    // New Year's Eve in London is still last year.
    expect(formatCreatedDate("2025-12-31T23:30:00Z", "2026-01-01", "en-GB")).toBe("31 Dec 2025");
    expect(formatCreatedDate("not a date", TODAY, "en-GB")).toBe("");
  });
});
