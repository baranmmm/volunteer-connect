// The Tasks page's automatic grouping ("Group by"): Source (meeting agenda item, meeting, event, other), Assignee, Due
// date or None. Pure (no React, no storage access besides the small remembered-state helpers), so it is unit tested.
// An "@all" task group arrives as one row (collapseGroups) and stays one row: in its source group, in its due bucket,
// and under "All members" when grouping by assignee.
import { z } from "zod";
import { addDays, type Task } from "@/lib/tasks";

export const TASK_GROUPINGS = ["source", "assignee", "due", "none"] as const;
export type TaskGrouping = (typeof TASK_GROUPINGS)[number];

export const taskSources = z.object({
  decisions: z
    .array(
      z.object({
        id: z.string().uuid(),
        agenda_item_id: z.string().uuid(),
        agenda_item: z.string(),
        meeting_id: z.string().uuid(),
        meeting: z.string(),
        starts_at: z.string(),
      }),
    )
    .default([]),
  meetings: z
    .array(z.object({ id: z.string().uuid(), title: z.string(), starts_at: z.string() }))
    .default([]),
  events: z
    .array(z.object({ id: z.string().uuid(), title: z.string(), start: z.string().nullable() }))
    .default([]),
});
export type TaskSources = z.infer<typeof taskSources>;
export const NO_SOURCES: TaskSources = { decisions: [], meetings: [], events: [] };

export type DueBucket = "overdue" | "thisWeek" | "nextWeek" | "later" | "earlier" | "none";
export const DUE_BUCKETS: readonly DueBucket[] = [
  "overdue",
  "thisWeek",
  "nextWeek",
  "later",
  "earlier",
  "none",
];

/** A section of the Tasks page: its header (kind + label parts), its tasks and the done/total progress. */
export type TaskSection = {
  key: string;
  kind:
    | "agenda"
    | "meeting"
    | "event"
    | "other"
    | "person"
    | "unassigned"
    | "allMembers"
    | "due"
    | "all";
  /** agenda: the agenda item; meeting/event: the title; person: the name; due: the bucket. */
  title: string;
  /** agenda: the meeting title. */
  meeting?: string | undefined;
  /** agenda/meeting/event: the London day "YYYY-MM-DD" (null when unknown). */
  date?: string | null | undefined;
  tasks: Task[];
  done: number;
  total: number;
};

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** London "YYYY-MM-DD" of an instant or a date (null for null). */
export function sourceDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : LONDON_DAY.format(d);
}

/** Monday of the London week that holds `day`. */
export function weekStart(day: string) {
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

/**
 * The due bucket: Overdue (open and before today), This week (today to Sunday, and done tasks due earlier this week),
 * Next week, Later, Earlier (done tasks due before this week), No date.
 */
export function dueBucket(task: Pick<Task, "due_date" | "status">, today: string): DueBucket {
  const due = task.due_date;
  if (!due) return "none";
  const monday = weekStart(today);
  const nextMonday = addDays(monday, 7);
  const afterNext = addDays(monday, 14);
  if (due < today) {
    if (task.status !== "done") return "overdue";
    return due >= monday ? "thisWeek" : "earlier";
  }
  if (due < nextMonday) return "thisWeek";
  if (due < afterNext) return "nextWeek";
  return "later";
}

function section(
  key: string,
  kind: TaskSection["kind"],
  title: string,
  extra: Partial<Pick<TaskSection, "meeting" | "date">> = {},
): TaskSection {
  return { key, kind, title, ...extra, tasks: [], done: 0, total: 0 };
}
function add(s: TaskSection, task: Task) {
  s.tasks.push(task);
  s.total += 1;
  if (task.status === "done") s.done += 1;
}

/** Where a task comes from: its decision's agenda item, else its meeting, else its event (only when visible). */
export function sourceKey(task: Task, sources: TaskSources) {
  const decision = task.decision_id
    ? sources.decisions.find((d) => d.id === task.decision_id)
    : undefined;
  if (decision) return `agenda:${decision.agenda_item_id}`;
  if (task.meeting_id && sources.meetings.some((m) => m.id === task.meeting_id))
    return `meeting:${task.meeting_id}`;
  if (task.event_id && sources.events.some((e) => e.id === task.event_id))
    return `event:${task.event_id}`;
  return "other";
}

/**
 * The sections for a grouping, in a stable order. Tasks keep their incoming order inside a section.
 * - source: meetings' agenda items and meetings (newest meeting first, agenda items in agenda order of appearance),
 *   then events (newest first), then "Other tasks";
 * - assignee: people by name, then "All members" (@all groups), then "Unassigned" (a task with several assignees is
 *   under each of them);
 * - due: Overdue, This week, Next week, Later, Earlier, No date;
 * - none: one section with every task.
 * Empty sections are dropped.
 */
export function groupTaskSections(
  tasks: Task[],
  grouping: TaskGrouping,
  sources: TaskSources,
  today: string,
  labels: { other: string; unassigned: string; allMembers: string; formerMember: string },
): TaskSection[] {
  if (grouping === "none") {
    const all = section("all", "all", "");
    for (const t of tasks) add(all, t);
    return all.total ? [all] : [];
  }
  if (grouping === "due") {
    const buckets = new Map(DUE_BUCKETS.map((b) => [b, section(`due:${b}`, "due", b)]));
    for (const t of tasks) add(buckets.get(dueBucket(t, today))!, t);
    return [...buckets.values()].filter((s) => s.total);
  }
  if (grouping === "assignee") {
    const people = new Map<string, TaskSection>();
    const allMembers = section("all-members", "allMembers", labels.allMembers);
    const unassigned = section("unassigned", "unassigned", labels.unassigned);
    for (const t of tasks) {
      if (t.group) {
        add(allMembers, t);
        continue;
      }
      if (!t.assignees.length) {
        add(unassigned, t);
        continue;
      }
      for (const p of t.assignees) {
        const key = `person:${p.id}`;
        const s = people.get(key) ?? section(key, "person", p.full_name ?? labels.formerMember);
        add(s, t);
        people.set(key, s);
      }
    }
    return [
      ...[...people.values()].sort(
        (a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
      ),
      allMembers,
      unassigned,
    ].filter((s) => s.total);
  }
  // Source.
  const byKey = new Map<string, TaskSection>();
  const meetingOrder = new Map<string, number>();
  for (const t of tasks) {
    const key = sourceKey(t, sources);
    let s = byKey.get(key);
    if (!s) {
      if (key.startsWith("agenda:")) {
        const d = sources.decisions.find((x) => x.id === t.decision_id)!;
        s = section(key, "agenda", d.agenda_item, {
          meeting: d.meeting,
          date: sourceDay(d.starts_at),
        });
        meetingOrder.set(key, sources.decisions.indexOf(d));
      } else if (key.startsWith("meeting:")) {
        const m = sources.meetings.find((x) => x.id === t.meeting_id)!;
        s = section(key, "meeting", m.title, { date: sourceDay(m.starts_at) });
      } else if (key.startsWith("event:")) {
        const e = sources.events.find((x) => x.id === t.event_id)!;
        s = section(key, "event", e.title, { date: sourceDay(e.start) });
      } else s = section("other", "other", labels.other);
      byKey.set(key, s);
    }
    add(s, t);
  }
  const rank = (s: TaskSection) =>
    s.kind === "agenda" || s.kind === "meeting" ? 0 : s.kind === "event" ? 1 : 2;
  return [...byKey.values()].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (a.kind === "other") return 0;
    // Newest first; agenda items of one meeting in agenda order.
    const byDate = (b.date ?? "").localeCompare(a.date ?? "");
    if (byDate) return byDate;
    if (a.kind === "agenda" && b.kind === "agenda" && a.meeting === b.meeting)
      return (meetingOrder.get(a.key) ?? 0) - (meetingOrder.get(b.key) ?? 0);
    return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
  });
}

/**
 * A section starts collapsed when every task in it is done (not in the Archived view, where every task is done),
 * unless the user opened or closed it themselves.
 */
export function isCollapsed(
  s: Pick<TaskSection, "key" | "done" | "total">,
  remembered: Record<string, boolean>,
  autoCollapse = true,
) {
  if (s.key in remembered) return remembered[s.key]!;
  return autoCollapse && s.total > 0 && s.done === s.total;
}

// ---------------------------------------------------------------------------------------------------------------
// Remembered per user (per browser): the grouping and the sections the user collapsed or opened. Storage may be
// unavailable: then the defaults apply.

const groupingKey = (userId: string) => `dsvh-tasks-grouping:${userId}`;
const collapsedKey = (userId: string) => `dsvh-tasks-collapsed:${userId}`;

export function readTaskGrouping(userId: string | undefined): TaskGrouping {
  if (!userId || typeof window === "undefined") return "source";
  try {
    const v = window.localStorage.getItem(groupingKey(userId));
    return (TASK_GROUPINGS as readonly string[]).includes(v ?? "") ? (v as TaskGrouping) : "source";
  } catch {
    return "source";
  }
}
export function saveTaskGrouping(userId: string | undefined, grouping: TaskGrouping) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(groupingKey(userId), grouping);
  } catch {
    /* storage unavailable */
  }
}

export function readCollapsed(userId: string | undefined): Record<string, boolean> {
  if (!userId || typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(collapsedKey(userId)) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, boolean] => typeof e[1] === "boolean"),
    );
  } catch {
    return {};
  }
}
export function saveCollapsed(userId: string | undefined, value: Record<string, boolean>) {
  if (!userId || typeof window === "undefined") return;
  try {
    // Keep the newest 200 entries (sections come and go with meetings and events).
    const entries = Object.entries(value).slice(-200);
    window.localStorage.setItem(collapsedKey(userId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage unavailable */
  }
}
