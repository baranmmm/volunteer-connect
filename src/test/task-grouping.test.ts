import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";
import { collapseGroups, type Task, type TaskGroupData } from "@/lib/tasks";
import {
  DUE_BUCKETS,
  TASK_GROUPINGS,
  dueBucket,
  groupTaskSections,
  isCollapsed,
  readCollapsed,
  readTaskGrouping,
  saveCollapsed,
  saveTaskGrouping,
  sourceDay,
  sourceKey,
  weekStart,
  type TaskSources,
} from "@/lib/task-grouping";

// The Tasks page's "Group by": source (agenda item, meeting, event, other), assignee, due date, none; done/total,
// collapsed by default when all done, and the remembered choices.
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

describe("source groups", () => {
  it("agenda items (one per item, newest meeting first, agenda order), meetings, events, then Other tasks", () => {
    const tasks = [
      task(1, { event_id: EVENT }),
      task(2, { decision_id: uuid(204), meeting_id: M_NEW }),
      task(3, { decision_id: uuid(202), meeting_id: M_NEW, status: "done" }),
      task(4, { decision_id: uuid(203), meeting_id: M_NEW }),
      task(5),
      task(6, { decision_id: uuid(201), meeting_id: M_OLD }),
      task(7, { meeting_id: M_OLD }),
    ];
    const s = groupTaskSections(tasks, "source", SOURCES, TODAY, LABELS);
    expect(s.map((x) => x.key)).toEqual([
      `agenda:${ITEM_A}`,
      `agenda:${ITEM_B}`,
      `agenda:${ITEM_OLD}`,
      `meeting:${M_OLD}`,
      `event:${EVENT}`,
      "other",
    ]);
    const iftar = s[0]!;
    expect(iftar).toMatchObject({
      kind: "agenda",
      title: "Iftar plan",
      meeting: "November committee",
      date: "2026-11-20",
      done: 1,
      total: 2,
    });
    expect(iftar.tasks.map((x) => x.id)).toEqual([uuid(3), uuid(4)]);
    expect(s.find((x) => x.kind === "event")).toMatchObject({
      title: "Winter dinner",
      date: "2026-12-12",
    });
    expect(s.at(-1)).toMatchObject({ kind: "other", title: "Other", total: 1 });
  });

  it("a source the caller may not see (no label from the server) falls back to Other tasks", () => {
    const t = task(1, { event_id: HIDDEN_EVENT, decision_id: uuid(299), meeting_id: uuid(399) });
    expect(sourceKey(t, SOURCES)).toBe("other");
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
    const s = groupTaskSections(rows, "source", SOURCES, TODAY, LABELS);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ key: `agenda:${ITEM_B}`, total: 1, done: 0 });
    expect(s[0]!.tasks[0]!.group?.id).toBe(uuid(500));
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
    expect(groupTaskSections([], "source", SOURCES, TODAY, LABELS)).toEqual([]);
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
  it("remembers the grouping and collapsed sections per user; defaults to Source; survives blocked storage", () => {
    expect(readTaskGrouping("u1")).toBe("source");
    saveTaskGrouping("u1", "due");
    expect(readTaskGrouping("u1")).toBe("due");
    expect(readTaskGrouping("u2")).toBe("source");
    localStorage.setItem("dsvh-tasks-grouping:u3", "status");
    expect(readTaskGrouping("u3")).toBe("source");
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
    expect(readTaskGrouping("u1")).toBe("source");
    expect(readCollapsed("u1")).toEqual({});
  });
  it("every grouping and due bucket has EN and TR labels", () => {
    for (const lang of [en, tr]) {
      const g = lang.tasks.grouping as { by: Record<string, string>; due: Record<string, string> };
      for (const x of TASK_GROUPINGS) expect(g.by[x]).toBeTruthy();
      for (const b of DUE_BUCKETS) expect(g.due[b]).toBeTruthy();
    }
  });
});
