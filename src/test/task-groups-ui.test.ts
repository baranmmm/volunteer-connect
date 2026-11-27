import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";
import {
  collapseGroups,
  deriveGroupStatus,
  filterTasks,
  groupCountParts,
  linkedRows,
  DEFAULT_FILTERS,
  type Task,
  type TaskGroupData,
} from "@/lib/tasks";
import {
  carrySearchKey,
  filterCarryOver,
  fullCarryOver,
  toggleCarryDecision,
  type CarryOverItem,
  type CarryOverMeeting,
} from "@/lib/meetings";
import { agendaCounts } from "@/components/meetings/meeting-ui";

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
  due_date: "2026-12-10",
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
const group = (extra: Partial<TaskGroupData> = {}): TaskGroupData => ({
  id: uuid(500),
  scope: "branch",
  branch_id: uuid(900),
  region_id: uuid(901),
  branch: "One",
  region: "Region",
  title: "Bring a friend",
  description: null,
  priority: "medium",
  due_date: "2026-12-20",
  event_id: null,
  meeting_id: null,
  decision_id: null,
  created_by: uuid(800),
  created_by_name: "Manager",
  created_at: "2026-11-26T10:00:00Z",
  status: "in_progress",
  member_count: 3,
  counts: { todo: 2, in_progress: 0, blocked: 0, done: 1 },
  archived: false,
  members: [
    { task_id: uuid(11), user_id: uuid(101), full_name: "A", status: "done", archived_at: null },
    { task_id: uuid(12), user_id: uuid(102), full_name: "B", status: "todo", archived_at: null },
    { task_id: uuid(13), user_id: uuid(103), full_name: "C", status: "todo", archived_at: null },
  ],
  mine: false,
  my_task_id: null,
  can_edit: true,
  ...extra,
});

describe("derived group status", () => {
  it("all done is done; any in progress or done is in progress; otherwise to do", () => {
    expect(deriveGroupStatus({ todo: 0, in_progress: 0, blocked: 0, done: 3 })).toBe("done");
    expect(deriveGroupStatus({ todo: 2, in_progress: 0, blocked: 0, done: 1 })).toBe("in_progress");
    expect(deriveGroupStatus({ todo: 1, in_progress: 1, blocked: 1, done: 0 })).toBe("in_progress");
    expect(deriveGroupStatus({ todo: 1, in_progress: 0, blocked: 2, done: 0 })).toBe("todo");
    expect(deriveGroupStatus({ todo: 0, in_progress: 0, blocked: 0, done: 0 })).toBe("todo");
  });
  it("lists the counts done first, without zeros", () => {
    expect(groupCountParts({ todo: 2, in_progress: 3, blocked: 0, done: 1 })).toEqual([
      { status: "done", count: 1 },
      { status: "in_progress", count: 3 },
      { status: "todo", count: 2 },
    ]);
  });
});

describe("views: one row per group", () => {
  const members = [
    task(11, { group_id: uuid(500), status: "done" }),
    task(12, { group_id: uuid(500) }),
    task(13, { group_id: uuid(500) }),
  ];
  it("someone outside the group sees ONE row with the derived status, not draggable", () => {
    const rows = collapseGroups([task(1), ...members], [group()]);
    expect(rows.map((r) => r.id)).toEqual([uuid(1), uuid(500)]);
    const row = rows[1]!;
    expect(row).toMatchObject({ status: "in_progress", can_set_status: false, mine: false });
    expect(row.group?.member_count).toBe(3);
    expect(row.assignees.map((a) => a.id)).toEqual([uuid(101), uuid(102), uuid(103)]);
    // Filters treat it like a task: a member filter finds it, "My tasks" does not.
    expect(
      filterTasks(rows, { ...DEFAULT_FILTERS, assignee: uuid(102) }, "2026-11-26"),
    ).toHaveLength(1);
    expect(filterTasks(rows, { ...DEFAULT_FILTERS, mine: true }, "2026-11-26")).toHaveLength(0);
  });
  it("a member sees only their own task", () => {
    const mine = [members[0]!, { ...members[1]!, mine: true }, members[2]!];
    const rows = collapseGroups(mine, [group({ mine: true, my_task_id: uuid(12) })]);
    expect(rows.map((r) => r.id)).toEqual([uuid(12)]);
    expect(rows[0]!.group).toBeUndefined();
  });
  it("member tasks of a group that is not listed stay as they are", () => {
    expect(collapseGroups(members, []).map((r) => r.id)).toEqual(members.map((m) => m.id));
  });
});

describe("linked rows and counts (meeting decisions, event page)", () => {
  it("collapses group members into one row, keeping order", () => {
    const rows = linkedRows([
      { id: "a" },
      { id: "b", group_id: "g" },
      { id: "c" },
      { id: "d", group_id: "g" },
    ]);
    expect(rows.map((r) => (r.kind === "group" ? `group:${r.tasks.length}` : r.task.id))).toEqual([
      "a",
      "group:2",
      "c",
    ]);
  });
  it("an agenda item counts a group once", () => {
    expect(
      agendaCounts({
        decisions: [
          { tasks: [{ id: "a" }, { id: "b", group_id: "g" }, { id: "c", group_id: "g" }] },
        ],
      }),
    ).toEqual({ decisions: 1, tasks: 2 });
  });
});

describe("carry-over choices", () => {
  const item: CarryOverItem = {
    id: uuid(1),
    title: "Hall",
    notes: null,
    decisions: [
      {
        id: uuid(2),
        text: "Quotes",
        tasks: [
          { id: uuid(3), title: "Get quotes", status: "todo", group_id: null, assignees: [] },
        ],
      },
      { id: uuid(4), text: "Date", tasks: [] },
    ],
  };
  it("ticking an item selects every decision; tasks are never sent (they are shared, not moved)", () => {
    expect(fullCarryOver(item)).toEqual({
      item_id: uuid(1),
      decision_ids: [uuid(2), uuid(4)],
      task_ids: [],
    });
  });
  it("unticking a decision drops it; ticking it again brings it back", () => {
    const off = toggleCarryDecision(fullCarryOver(item), uuid(2), false);
    expect(off).toEqual({ item_id: uuid(1), decision_ids: [uuid(4)], task_ids: [] });
    expect(toggleCarryDecision(off, uuid(2), true).decision_ids).toEqual([uuid(4), uuid(2)]);
  });
});

describe("carry-over search", () => {
  const item = (n: number, title: string, decisions: string[] = []): CarryOverItem => ({
    id: uuid(n),
    title,
    notes: null,
    decisions: decisions.map((text, i) => ({ id: uuid(n * 10 + i), text, tasks: [] })),
  });
  const meetings: CarryOverMeeting[] = [
    {
      meeting_id: uuid(90),
      meeting_title: "2 Dec",
      starts_at: "2026-12-02T18:00:00Z",
      items: [item(1, "Christmas Dinner", ["Book a venue"]), item(2, "Flyers")],
    },
    {
      meeting_id: uuid(91),
      meeting_title: "25 Nov",
      starts_at: "2026-11-25T18:00:00Z",
      items: [item(3, "Iftar", ["Çıkış saatini belirle"]), item(4, "Rota", ["Ask the venue"])],
    },
  ];
  const ids = (query: string) =>
    filterCarryOver(meetings, query).map((m) => [m.meeting_id, m.items.map((i) => i.id)]);
  it("an empty query keeps everything", () => {
    expect(filterCarryOver(meetings, "  ")).toBe(meetings);
  });
  it("matches item titles and decision texts; meetings without a match drop out", () => {
    expect(ids("christmas")).toEqual([[uuid(90), [uuid(1)]]]);
    expect(ids("venue")).toEqual([
      [uuid(90), [uuid(1)]],
      [uuid(91), [uuid(4)]],
    ]);
    expect(ids("nothing like this")).toEqual([]);
  });
  it("every word must match, in any order, ignoring case, accents and the Turkish dotless i", () => {
    expect(ids("venue book")).toEqual([[uuid(90), [uuid(1)]]]);
    expect(ids("CIKIS")).toEqual([[uuid(91), [uuid(3)]]]);
    expect(carrySearchKey("İstanbul Çıkış")).toBe("istanbul cikis");
  });
});

describe("new strings exist in both languages", () => {
  const get = (o: unknown, key: string) =>
    key.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
  const keys = (o: Record<string, unknown>, prefix: string): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object"
        ? keys(v as Record<string, unknown>, `${prefix}.${k}`)
        : [`${prefix}.${k}`],
    );
  it("tasks.groups, meetings.carry and the new errors match in English and Turkish", () => {
    for (const ns of ["tasks.groups", "meetings.carry", "meetings.carryIn"]) {
      const enKeys = keys(get(en, ns) as Record<string, unknown>, ns).sort();
      const trKeys = keys(get(tr, ns) as Record<string, unknown>, ns).sort();
      expect(trKeys).toEqual(enKeys);
    }
    for (const k of [
      "taskGroupNotFound",
      "taskGroupNoMembers",
      "taskGroupAlreadyMember",
      "taskGroupLastMember",
      "carryOverItem",
    ]) {
      expect(typeof get(en, `errors.${k}`)).toBe("string");
      expect(typeof get(tr, `errors.${k}`)).toBe("string");
    }
  });
});
