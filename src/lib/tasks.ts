import { z } from "zod";

// Shared (client and server) task schemas, constants and pure helpers. The database decides permissions; the
// can_edit / can_set_status flags it returns only drive the UI.

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const REPEAT_KINDS = ["none", "daily", "every_n", "weekly"] as const;
export const BEFORE_DAY_OPTIONS = [1, 2, 3, 7] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type RepeatKind = (typeof REPEAT_KINDS)[number];
export const WORK_SCOPES = ["branch", "region", "national"] as const;
export type WorkScope = (typeof WORK_SCOPES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const person = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
  role: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
});
export type Person = z.infer<typeof person>;

export const task = z.object({
  id: z.string().uuid(),
  scope: z.enum(WORK_SCOPES),
  branch_id: z.string().uuid().nullable(),
  region_id: z.string().uuid().nullable(),
  branch: z.string().nullable(),
  region: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  due_date: isoDate.nullable(),
  self_task: z.boolean(),
  created_by: z.string().uuid().nullable(),
  created_by_name: z.string().nullable(),
  event_id: z.string().uuid().nullable(),
  meeting_id: z.string().uuid().nullable(),
  decision_id: z.string().uuid().nullable(),
  created_at: z.string(),
  /** Done tasks can be archived: hidden from Kanban, list and calendar unless the "Archived" filter is on. */
  archived_at: z.string().nullable(),
  /** A member's task of an "@all" task group (task_groups). */
  group_id: z.string().uuid().nullable().optional(),
  note_count: z.number(),
  assignees: z.array(person),
  mine: z.boolean(),
  can_edit: z.boolean(),
  can_set_status: z.boolean(),
  /** Archive / unarchive a done task: assignees and editors, never a trustee. Absent before the trustee migration. */
  can_archive: z.boolean().optional(),
});
/** A task in the views: an ordinary task, or (with `group`) one row standing for a whole task group. */
export type Task = z.infer<typeof task> & { group?: TaskGroupData };

export const reminderSettings = z.object({
  before_days: z.array(z.number().int().min(1).max(365)).max(6),
  repeat_kind: z.enum(REPEAT_KINDS),
  repeat_every_days: z.number().int().min(2).max(90).nullable(),
  repeat_start: isoDate.nullable(),
  overdue_every_days: z.number().int().min(1).max(90).nullable(),
});
export type ReminderSettings = z.infer<typeof reminderSettings>;
/** Reminders are off for every new task (nothing is sent) until the user turns them on. */
export const NO_REMINDERS: ReminderSettings = {
  before_days: [],
  repeat_kind: "none",
  repeat_every_days: null,
  repeat_start: null,
  overdue_every_days: null,
};
/** What "Turn reminders on" starts from in the form. */
export const DEFAULT_REMINDERS: ReminderSettings = { ...NO_REMINDERS, before_days: [3] };
/** True when a reminder setting would send anything. */
export function remindersOn(r: ReminderSettings) {
  return r.before_days.length > 0 || r.repeat_kind !== "none" || r.overdue_every_days !== null;
}

export const taskDetail = task.extend({
  reminders: reminderSettings,
  my_reminders_muted: z.boolean().nullable(),
  /** The caller's own reminders on a task assigned to them (only for them); null when none are on. */
  my_reminders: reminderSettings.nullable().optional(),
  event_title: z.string().nullable(),
  meeting_title: z.string().nullable(),
  decision_text: z.string().nullable(),
});
export type TaskDetail = z.infer<typeof taskDetail>;

export const taskSummary = z.object({
  open: z.number(),
  overdue: z.number(),
  today: isoDate,
  next: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      status: z.enum(TASK_STATUSES),
      priority: z.enum(TASK_PRIORITIES),
      due_date: isoDate.nullable(),
      /** Added by the dashboard server function (not the RPC): who the task is assigned to. */
      assignees: z.array(z.object({ id: z.string(), full_name: z.string().nullable() })).optional(),
    }),
  ),
});
export type TaskSummary = z.infer<typeof taskSummary>;

export const linkedTask = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(TASK_STATUSES),
  due_date: isoDate.nullable().optional(),
  archived_at: z.string().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
});
export type LinkedTask = z.infer<typeof linkedTask>;

/**
 * An "@all" task group (get_task_group / list_task_groups): one task per member, a derived status (never stored)
 * and per-status counts.
 */
export const taskGroup = z.object({
  id: z.string().uuid(),
  scope: z.literal("branch"),
  branch_id: z.string().uuid(),
  region_id: z.string().uuid(),
  branch: z.string().nullable(),
  region: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(TASK_PRIORITIES),
  due_date: isoDate.nullable(),
  event_id: z.string().uuid().nullable(),
  meeting_id: z.string().uuid().nullable(),
  decision_id: z.string().uuid().nullable(),
  created_by: z.string().uuid().nullable(),
  created_by_name: z.string().nullable(),
  created_at: z.string(),
  status: z.enum(TASK_STATUSES),
  member_count: z.number(),
  counts: z.object({
    todo: z.number(),
    in_progress: z.number(),
    blocked: z.number(),
    done: z.number(),
  }),
  /** Every member task is archived. */
  archived: z.boolean(),
  members: z.array(
    z.object({
      task_id: z.string().uuid(),
      user_id: z.string().uuid().nullable(),
      full_name: z.string().nullable(),
      status: z.enum(TASK_STATUSES),
      archived_at: z.string().nullable(),
    }),
  ),
  /** The caller is a member (has their own task in the group). */
  mine: z.boolean(),
  my_task_id: z.string().uuid().nullable(),
  can_edit: z.boolean(),
});
export type TaskGroupData = z.infer<typeof taskGroup>;
export type TaskGroupCounts = TaskGroupData["counts"];

/**
 * The group's status from its members' statuses (the database computes the same in task_group_status): all done →
 * done; any in progress or done → in progress; otherwise to do (blocked members count as to do).
 */
export function deriveGroupStatus(c: TaskGroupCounts): TaskStatus {
  const total = c.todo + c.in_progress + c.blocked + c.done;
  if (total > 0 && c.done === total) return "done";
  if (c.in_progress > 0 || c.done > 0) return "in_progress";
  return "todo";
}

/** "1 Done · 3 In progress · 2 To do" parts (status order done, in progress, blocked, to do; zero counts left out). */
export function groupCountParts(c: TaskGroupCounts) {
  return (["done", "in_progress", "blocked", "todo"] as const)
    .filter((s) => c[s] > 0)
    .map((s) => ({ status: s, count: c[s] }));
}

/**
 * The task list as the views show it. A group the caller is not a member of becomes ONE row (`group` set, id = the
 * group id, status = the derived status, the members as assignees) instead of its member tasks; for a group the caller
 * is a member of, only their own task is shown (as an ordinary task). Member tasks of a group missing from `groups`
 * stay as they are.
 */
export function collapseGroups(tasks: readonly Task[], groups: readonly TaskGroupData[]): Task[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: Task[] = [];
  const added = new Set<string>();
  for (const t of tasks) {
    const g = t.group_id ? byId.get(t.group_id) : undefined;
    if (!g) {
      out.push(t);
      continue;
    }
    if (g.mine) {
      if (t.mine) out.push(t);
      continue;
    }
    if (added.has(g.id)) continue;
    added.add(g.id);
    out.push(groupRow(g));
  }
  // Groups whose member tasks are not in the list (e.g. beyond the list limit) still get their row.
  for (const g of groups)
    if (!g.mine && !added.has(g.id) && g.member_count > 0) {
      added.add(g.id);
      out.push(groupRow(g));
    }
  return out;
}

/** One row standing for a group in the views (not draggable, no status of its own). */
export function groupRow(g: TaskGroupData): Task {
  return {
    id: g.id,
    scope: "branch",
    branch_id: g.branch_id,
    region_id: g.region_id,
    branch: g.branch,
    region: g.region,
    title: g.title,
    description: g.description,
    status: g.status,
    priority: g.priority,
    due_date: g.due_date,
    self_task: false,
    created_by: g.created_by,
    created_by_name: g.created_by_name,
    event_id: g.event_id,
    meeting_id: g.meeting_id,
    decision_id: g.decision_id,
    created_at: g.created_at,
    archived_at: g.archived ? g.created_at : null,
    group_id: null,
    note_count: 0,
    assignees: g.members
      .filter((m) => m.user_id)
      .map((m) => ({ id: m.user_id!, full_name: m.full_name })),
    mine: false,
    can_edit: g.can_edit,
    can_set_status: false,
    can_archive: false,
    group: g,
  };
}

/** Linked task rows (meeting decision, event page): one entry per group instead of its member tasks. */
export type LinkedRow<T> =
  { kind: "task"; task: T } | { kind: "group"; groupId: string; tasks: T[] };
export function linkedRows<T extends { id: string; group_id?: string | null | undefined }>(
  tasks: readonly T[],
): LinkedRow<T>[] {
  const rows: LinkedRow<T>[] = [];
  const groups = new Map<string, { kind: "group"; groupId: string; tasks: T[] }>();
  for (const t of tasks) {
    if (!t.group_id) {
      rows.push({ kind: "task", task: t });
      continue;
    }
    const existing = groups.get(t.group_id);
    if (existing) existing.tasks.push(t);
    else {
      const row = { kind: "group" as const, groupId: t.group_id, tasks: [t] };
      groups.set(t.group_id, row);
      rows.push(row);
    }
  }
  return rows;
}

/** A note on a task (author, time, mentions). Only the author may edit or delete it ("mine"). */
export const taskNote = z.object({
  id: z.string().uuid(),
  body: z.string(),
  author_id: z.string().uuid().nullable(),
  author_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  edited: z.boolean(),
  mine: z.boolean(),
  mentions: z.array(z.object({ id: z.string().uuid(), full_name: z.string().nullable() })),
});
export type TaskNote = z.infer<typeof taskNote>;
export const TASK_NOTE_MAX = 4000;

/** Input of create_task_group ("@all") and update_task_group (validated again in the database). */
export const taskGroupInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  due_date: isoDate.nullable().optional(),
});
export type TaskGroupInput = z.infer<typeof taskGroupInput>;

/** Input of create_task / update_task (validated again in the database). */
export const taskInput = z.object({
  scope: z.enum(WORK_SCOPES).optional(),
  branch_id: z.string().uuid().nullable().optional(),
  region_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  due_date: isoDate.nullable().optional(),
  event_id: z.string().uuid().nullable().optional(),
  decision_id: z.string().uuid().nullable().optional(),
  assignee_ids: z.array(z.string().uuid()).max(50).optional(),
  reminders: reminderSettings.optional(),
});
export type TaskInput = z.infer<typeof taskInput>;

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (views, filters, dashboard)

/** London calendar day (YYYY-MM-DD) of an instant. */
export function londonDay(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}
export function isOverdue(t: { due_date: string | null; status: TaskStatus }, today: string) {
  return t.status !== "done" && !!t.due_date && t.due_date < today;
}
/** Due today or tomorrow and not done. */
export function isDueSoon(t: { due_date: string | null; status: TaskStatus }, today: string) {
  if (t.status === "done" || !t.due_date) return false;
  return t.due_date >= today && t.due_date <= addDays(today, 1);
}
export function addDays(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type TaskFilters = {
  mine: boolean;
  status: TaskStatus | "all";
  priority: TaskPriority | "all";
  assignee: string | "all";
  /**
   * Branch filter (RD/NC): branch ids and/or REGION_WIDE; empty = all. Region filter (NC): region ids and/or
   * NATIONAL; empty = all. Both are ignored while "My tasks" is on (it shows every task assigned to the caller).
   */
  branches: string[];
  regions: string[];
  due: "all" | "overdue" | "week" | "none";
  /** true: only archived tasks; false or missing: archived tasks are hidden. */
  archived?: boolean;
};
export const DEFAULT_FILTERS: TaskFilters = {
  mine: false,
  status: "all",
  priority: "all",
  assignee: "all",
  branches: [],
  regions: [],
  due: "all",
};

/** Branch filter value for region-scope tasks. */
export const REGION_WIDE = "region-wide";
/** Region filter value for national tasks. */
export const NATIONAL = "national";

/** Whether a task passes the branch/region filters (empty filter = all). "My tasks" overrides both. */
export function matchesScopeFilter(
  t: Pick<Task, "scope" | "branch_id" | "region_id" | "mine">,
  f: Pick<TaskFilters, "mine" | "branches" | "regions">,
) {
  if (f.mine) return true;
  const regionOk =
    f.regions.length === 0 ||
    (t.scope === "national"
      ? f.regions.includes(NATIONAL)
      : !!t.region_id && f.regions.includes(t.region_id));
  const branchOk =
    f.branches.length === 0 ||
    (t.scope === "branch"
      ? !!t.branch_id && f.branches.includes(t.branch_id)
      : t.scope === "region" && f.branches.includes(REGION_WIDE));
  return regionOk && branchOk;
}

export function filterTasks(tasks: Task[], f: TaskFilters, today: string) {
  return tasks.filter(
    (t) =>
      (f.archived ? !!t.archived_at : !t.archived_at) &&
      (!f.mine || t.mine) &&
      (f.status === "all" || t.status === f.status) &&
      (f.priority === "all" || t.priority === f.priority) &&
      (f.assignee === "all" || t.assignees.some((a) => a.id === f.assignee)) &&
      matchesScopeFilter(t, f) &&
      (f.due === "all" ||
        (f.due === "overdue" && isOverdue(t, today)) ||
        (f.due === "none" && !t.due_date) ||
        (f.due === "week" &&
          !!t.due_date &&
          t.due_date >= today &&
          t.due_date <= addDays(today, 7))),
  );
}

export type TaskSort = "due" | "priority" | "title" | "status";
const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
export function sortTasks(tasks: Task[], sort: TaskSort) {
  const byDue = (a: Task, b: Task) =>
    (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31");
  return [...tasks].sort((a, b) => {
    const primary =
      sort === "priority"
        ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        : sort === "title"
          ? a.title.localeCompare(b.title)
          : sort === "status"
            ? TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status)
            : byDue(a, b);
    return primary || byDue(a, b) || a.id.localeCompare(b.id);
  });
}

export type TaskGroup = "none" | "status" | "assignee" | "mine";
/**
 * Groups in a stable order; a task with several assignees appears under each of them. "mine" puts the tasks assigned
 * to the caller first ("mine", then "others"; labels are i18n keys for the view).
 */
export function groupTasks(tasks: Task[], group: TaskGroup, unassigned: string) {
  if (group === "none") return [{ key: "all", label: "", tasks }];
  if (group === "mine")
    return [
      { key: "mine", label: "tasks.filters.groupMine", tasks: tasks.filter((t) => t.mine) },
      { key: "others", label: "tasks.filters.groupOthers", tasks: tasks.filter((t) => !t.mine) },
    ].filter((g) => g.tasks.length > 0);
  if (group === "status")
    return TASK_STATUSES.map((s) => ({
      key: s,
      label: s,
      tasks: tasks.filter((t) => t.status === s),
    })).filter((g) => g.tasks.length > 0);
  const groups = new Map<string, { key: string; label: string; tasks: Task[] }>();
  for (const t of tasks) {
    const people = t.assignees.length ? t.assignees : [{ id: "none", full_name: unassigned }];
    for (const p of people) {
      const g = groups.get(p.id) ?? { key: p.id, label: p.full_name ?? unassigned, tasks: [] };
      g.tasks.push(t);
      groups.set(p.id, g);
    }
  }
  return [...groups.values()].sort((a, b) =>
    a.key === "none" ? 1 : b.key === "none" ? -1 : a.label.localeCompare(b.label),
  );
}

/** The same tasks with the caller's own first (stable: the order inside each part is kept). */
export function mineFirst<T extends { mine: boolean }>(tasks: T[]) {
  return [...tasks.filter((t) => t.mine), ...tasks.filter((t) => !t.mine)];
}

/** Archive or unarchive allowed (can_archive; before the trustee migration it followed can_set_status). */
export const canArchive = (t: Pick<Task, "can_set_status" | "can_archive">) =>
  t.can_archive ?? t.can_set_status;

/** Ids for "Archive all done": shown done tasks that are not archived and whose status the caller may change. */
export function archivableDoneIds(tasks: Task[]) {
  return tasks
    .filter((t) => t.status === "done" && !t.archived_at && canArchive(t))
    .map((t) => t.id);
}

/**
 * The event page's linked tasks: the tasks linked to the event plus, for a meeting's calendar entry, the tasks from
 * the meeting's decisions. Each task once (a task can be both), ordered by due date (none last), then as given.
 */
export function mergeLinkedTasks<T extends { id: string; due_date?: string | null | undefined }>(
  linked: readonly T[],
  fromMeeting: readonly T[],
) {
  const seen = new Set<string>();
  const all: { task: T; order: number }[] = [];
  for (const task of [...linked, ...fromMeeting]) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    all.push({ task, order: all.length });
  }
  return all
    .sort(
      (a, b) =>
        (a.task.due_date ?? "9999-12-31").localeCompare(b.task.due_date ?? "9999-12-31") ||
        a.order - b.order,
    )
    .map((x) => x.task);
}

/** The event page's linked tasks: archived ones are hidden unless there is nothing else to show. */
export function visibleEventTasks<T extends { archived_at?: string | null | undefined }>(
  tasks: T[],
) {
  const active = tasks.filter((t) => !t.archived_at);
  return active.length ? active : tasks;
}

/**
 * Whether the caller has at least one (not archived) task assigned. /tasks no longer uses it for its default: every
 * task is shown and "My tasks" starts off, with the caller's own tasks marked.
 */
export function defaultMineFilter(tasks: Task[]) {
  return tasks.some((t) => t.mine && !t.archived_at);
}

/** True when the edit added exactly one "@" just before the caret (typing "@" opens the mention picker). */
export function typedMentionTrigger(prev: string, next: string, caret: number) {
  return next.length === prev.length + 1 && caret > 0 && next[caret - 1] === "@";
}

/**
 * Inserts "@Name " for a chosen person. When the text right before the caret is the "@" that opened the picker it is
 * replaced; otherwise the mention is added at the caret (with a space before it when needed). Returns the new text
 * and caret position.
 */
export function insertMention(body: string, caret: number, name: string) {
  const at = Math.max(0, Math.min(caret, body.length));
  const trigger = at > 0 && body[at - 1] === "@";
  const start = trigger ? at - 1 : at;
  const before = body.slice(0, start);
  const gap = before && !/\s$/.test(before) ? " " : "";
  const insert = `${gap}@${name} `;
  return { body: before + insert + body.slice(at), caret: start + insert.length };
}

export type ReminderErrors = Partial<
  Record<"before_days" | "repeat_every_days" | "overdue_every_days", string>
>;
/** Validates the Reminders section of the task form. Returns error keys (i18n). */
export function validateReminders(r: ReminderSettings): ReminderErrors {
  const errors: ReminderErrors = {};
  if (
    r.before_days.some((d) => !Number.isInteger(d) || d < 1 || d > 365) ||
    r.before_days.length > 6
  )
    errors.before_days = "tasks.errors.beforeDays";
  if (
    r.repeat_kind === "every_n" &&
    (r.repeat_every_days === null ||
      !Number.isInteger(r.repeat_every_days) ||
      r.repeat_every_days < 2 ||
      r.repeat_every_days > 90)
  )
    errors.repeat_every_days = "tasks.errors.repeatEvery";
  if (
    r.overdue_every_days !== null &&
    (!Number.isInteger(r.overdue_every_days) ||
      r.overdue_every_days < 1 ||
      r.overdue_every_days > 90)
  )
    errors.overdue_every_days = "tasks.errors.overdueEvery";
  return errors;
}

/** The reminder inputs as typed (strings for the number fields), shared by the task form and "My reminders". */
export type ReminderDraft = {
  before: number[];
  custom: string;
  kind: RepeatKind;
  every: string;
  start: string;
  overdueOn: boolean;
  overdueEvery: string;
};
const BEFORE_PRESETS: readonly number[] = BEFORE_DAY_OPTIONS;
/** The inputs for existing settings (the first non-preset day goes into the custom field). */
export function reminderDraft(r: ReminderSettings, today: string = londonDay()): ReminderDraft {
  const extra = r.before_days.find((d) => !BEFORE_PRESETS.includes(d));
  return {
    before: r.before_days.filter((d) => BEFORE_PRESETS.includes(d)),
    custom: extra === undefined ? "" : String(extra),
    kind: r.repeat_kind,
    every: r.repeat_every_days === null ? "" : String(r.repeat_every_days),
    start: r.repeat_start ?? today,
    overdueOn: r.overdue_every_days !== null,
    overdueEvery: String(r.overdue_every_days ?? 1),
  };
}
/** Turns the inputs into the settings sent to the database (invalid numbers stay invalid for validation). */
export function buildReminders(d: ReminderDraft, today: string = londonDay()): ReminderSettings {
  const before = [...d.before];
  if (d.custom.trim() !== "") before.push(Number(d.custom));
  return {
    before_days: [...new Set(before)].sort((a, b) => a - b),
    repeat_kind: d.kind,
    repeat_every_days:
      d.kind === "every_n" ? (d.every.trim() === "" ? null : Number(d.every)) : null,
    repeat_start: d.kind === "none" ? null : d.start || today,
    overdue_every_days: d.overdueOn ? Number(d.overdueEvery) : null,
  };
}

/**
 * A readable summary of reminder settings as i18n keys with parameters (the panel turns them into lines). `date` is a
 * London day the caller formats.
 */
export function reminderSummary(
  r: ReminderSettings,
): { key: string; params?: Record<string, string | number>; date?: string }[] {
  const lines: { key: string; params?: Record<string, string | number>; date?: string }[] = [];
  lines.push(
    r.before_days.length
      ? { key: "tasks.reminders.before", params: { days: r.before_days.join(", ") } }
      : { key: "tasks.reminders.noBefore" },
  );
  if (r.repeat_kind === "every_n")
    lines.push({ key: "tasks.reminders.everyN", params: { count: r.repeat_every_days ?? 0 } });
  else if (r.repeat_kind !== "none") lines.push({ key: `tasks.reminders.${r.repeat_kind}` });
  if (r.repeat_kind !== "none" && r.repeat_start)
    lines.push({ key: "tasks.reminders.startingOn", date: r.repeat_start });
  if (r.overdue_every_days)
    lines.push({ key: "tasks.reminders.overdue", params: { count: r.overdue_every_days } });
  return lines;
}

/** True when the caller can create in exactly one place (list_my_work_scopes): scope labels and pickers are hidden. */
export function isSingleScope(scopes: readonly unknown[] | undefined | null) {
  return (scopes?.length ?? 0) === 1;
}

// ---------------------------------------------------------------------------------------------------------------
// The chosen Tasks view (per user, per browser). Storage may be unavailable: then the default view is used.

export const TASK_VIEWS = ["kanban", "list", "calendar"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
const viewKey = (userId: string) => `dsvh-tasks-view:${userId}`;
export function readTaskView(userId: string | undefined): TaskView {
  if (!userId || typeof window === "undefined") return "list";
  try {
    const v = window.localStorage.getItem(viewKey(userId));
    return (TASK_VIEWS as readonly string[]).includes(v ?? "") ? (v as TaskView) : "list";
  } catch {
    return "list";
  }
}
export function saveTaskView(userId: string | undefined, view: TaskView) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(viewKey(userId), view);
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Branch/region filters for people with more than one work scope (RD, NC).

type ScopeSource = {
  scope: WorkScope;
  branch_id: string | null;
  region_id: string | null;
};
export type ScopeFilterOptions = {
  /** [region id or NATIONAL, label (null for NATIONAL: the view translates it)] */
  regions: [string, string | null][];
  /** [branch id or REGION_WIDE, label (null for REGION_WIDE)] */
  branches: [string, string | null][];
};

/**
 * Options for the branch/region filters, from the visible tasks and the caller's work scopes (labels from task names
 * and scope labels). Branch options narrow to the selected regions; "Region-wide" is offered when there is a
 * region-scope task or scope in them, "National" when there is a national one.
 */
export function scopeFilterOptions(
  tasks: (ScopeSource & { branch: string | null; region: string | null })[],
  scopes: (ScopeSource & { label: string | null })[],
  selectedRegions: string[],
  unnamed: string,
): ScopeFilterOptions {
  const regions = new Map<string, string>();
  const branches = new Map<string, { label: string; region: string | null }>();
  let national = false;
  const regionWideIn = new Set<string>();
  const add = (s: ScopeSource, branchLabel: string | null, regionLabel: string | null) => {
    if (s.scope === "national") {
      national = true;
      return;
    }
    if (s.region_id && (regionLabel || !regions.has(s.region_id)))
      regions.set(s.region_id, regionLabel ?? regions.get(s.region_id) ?? unnamed);
    if (s.scope === "region" && s.region_id) regionWideIn.add(s.region_id);
    if (s.scope === "branch" && s.branch_id && (branchLabel || !branches.has(s.branch_id)))
      branches.set(s.branch_id, {
        label: branchLabel ?? branches.get(s.branch_id)?.label ?? unnamed,
        region: s.region_id ?? branches.get(s.branch_id)?.region ?? null,
      });
  };
  for (const s of scopes)
    add(s, s.scope === "branch" ? s.label : null, s.scope === "region" ? s.label : null);
  for (const t of tasks) add(t, t.branch, t.region);
  const byLabel = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
  const inRegions = (region: string | null) =>
    selectedRegions.length === 0 || (!!region && selectedRegions.includes(region));
  const branchList = [...branches]
    .filter(([, b]) => inRegions(b.region))
    .map(([id, b]) => [id, b.label] as [string, string])
    .sort(byLabel);
  const regionWide = [...regionWideIn].some(inRegions);
  return {
    regions: [
      ...[...regions].sort(byLabel),
      ...(national ? [[NATIONAL, null] as [string, null]] : []),
    ],
    branches: [...branchList, ...(regionWide ? [[REGION_WIDE, null] as [string, null]] : [])],
  };
}

/** The selection limited to values that are still offered (a remembered branch that is gone no longer filters). */
export function effectiveScopeSelection(selected: string[], options: [string, unknown][]) {
  const offered = new Set(options.map(([v]) => v));
  return selected.filter((v) => offered.has(v));
}

// The chosen branch/region filters (per user, per browser). Storage may be unavailable: then nothing is filtered.
export type RememberedScopeFilter = { branches: string[]; regions: string[] };
const EMPTY_SCOPE_FILTER: RememberedScopeFilter = { branches: [], regions: [] };
const filtersKey = (userId: string) => `dsvh-tasks-filters:${userId}`;
const filterValues = (v: unknown) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64)
        .slice(0, 200)
    : [];
export function readTaskScopeFilter(userId: string | undefined): RememberedScopeFilter {
  if (!userId || typeof window === "undefined") return EMPTY_SCOPE_FILTER;
  try {
    const raw = window.localStorage.getItem(filtersKey(userId));
    if (!raw) return EMPTY_SCOPE_FILTER;
    const v = JSON.parse(raw) as { branches?: unknown; regions?: unknown } | null;
    if (!v || typeof v !== "object") return EMPTY_SCOPE_FILTER;
    return { branches: filterValues(v.branches), regions: filterValues(v.regions) };
  } catch {
    return EMPTY_SCOPE_FILTER;
  }
}
export function saveTaskScopeFilter(userId: string | undefined, f: RememberedScopeFilter) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      filtersKey(userId),
      JSON.stringify({ branches: f.branches, regions: f.regions }),
    );
  } catch {
    /* storage unavailable */
  }
}
