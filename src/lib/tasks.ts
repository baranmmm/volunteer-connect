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
  assignees: z.array(person),
  mine: z.boolean(),
  can_edit: z.boolean(),
  can_set_status: z.boolean(),
});
export type Task = z.infer<typeof task>;

export const reminderSettings = z.object({
  before_days: z.array(z.number().int().min(1).max(365)).max(6),
  repeat_kind: z.enum(REPEAT_KINDS),
  repeat_every_days: z.number().int().min(2).max(90).nullable(),
  repeat_start: isoDate.nullable(),
  overdue_every_days: z.number().int().min(1).max(90).nullable(),
});
export type ReminderSettings = z.infer<typeof reminderSettings>;
export const DEFAULT_REMINDERS: ReminderSettings = {
  before_days: [3],
  repeat_kind: "none",
  repeat_every_days: null,
  repeat_start: null,
  overdue_every_days: null,
};

export const taskDetail = task.extend({
  reminders: reminderSettings,
  my_reminders_muted: z.boolean().nullable(),
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
    }),
  ),
});
export type TaskSummary = z.infer<typeof taskSummary>;

export const linkedTask = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(TASK_STATUSES),
  due_date: isoDate.nullable().optional(),
});

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
  branch: string | "all";
  due: "all" | "overdue" | "week" | "none";
};
export const DEFAULT_FILTERS: TaskFilters = {
  mine: false,
  status: "all",
  priority: "all",
  assignee: "all",
  branch: "all",
  due: "all",
};

export function filterTasks(tasks: Task[], f: TaskFilters, today: string) {
  return tasks.filter(
    (t) =>
      (!f.mine || t.mine) &&
      (f.status === "all" || t.status === f.status) &&
      (f.priority === "all" || t.priority === f.priority) &&
      (f.assignee === "all" || t.assignees.some((a) => a.id === f.assignee)) &&
      (f.branch === "all" || (f.branch === "none" ? !t.branch_id : t.branch_id === f.branch)) &&
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

export type TaskGroup = "none" | "status" | "assignee";
/** Groups in a stable order; a task with several assignees appears under each of them. */
export function groupTasks(tasks: Task[], group: TaskGroup, unassigned: string) {
  if (group === "none") return [{ key: "all", label: "", tasks }];
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

// ---------------------------------------------------------------------------------------------------------------
// The chosen Tasks view (per user, per browser). Storage may be unavailable: then the default view is used.

export const TASK_VIEWS = ["kanban", "list", "calendar"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
const viewKey = (userId: string) => `dsvh-tasks-view:${userId}`;
export function readTaskView(userId: string | undefined): TaskView {
  if (!userId || typeof window === "undefined") return "kanban";
  try {
    const v = window.localStorage.getItem(viewKey(userId));
    return (TASK_VIEWS as readonly string[]).includes(v ?? "") ? (v as TaskView) : "kanban";
  } catch {
    return "kanban";
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
