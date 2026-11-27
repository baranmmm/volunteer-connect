// The Tasks page's automatic grouping ("Group by"): Meeting (the default: meeting > agenda item > tasks, then an
// "Events" section and "Other tasks"), Assignee, Due date or None. Pure (no React, no storage access besides the small
// remembered-state helpers), so it is unit tested. An "@all" task group arrives as one row (collapseGroups) and stays
// one row: under its meeting's agenda item, event or Other tasks, in its due bucket, and under "All members" when
// grouping by assignee.
import { z } from "zod";
import { TASK_STATUSES, addDays, type Task } from "@/lib/tasks";

export const TASK_GROUPINGS = ["meeting", "assignee", "due", "none"] as const;
export type TaskGrouping = (typeof TASK_GROUPINGS)[number];

export const taskSources = z.object({
  /** In agenda order: meeting start, agenda position, decision id (list_task_sources). */
  decisions: z
    .array(
      z.object({
        id: z.string().uuid(),
        agenda_item_id: z.string().uuid(),
        agenda_item: z.string(),
        meeting_id: z.string().uuid(),
        meeting: z.string(),
        starts_at: z.string(),
        /** The decision text (read through RLS next to the RPC; missing when that read failed). */
        text: z.string().nullable().optional(),
        /** Later meetings the decision was carried into: its tasks show there too (20261221090000). */
        also_in: z
          .array(
            z.object({ meeting_id: z.string().uuid(), meeting: z.string(), starts_at: z.string() }),
          )
          .optional(),
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

/**
 * A section of the Tasks page: its header (kind + label parts), its own task rows, its nested sections (Meeting
 * grouping: a meeting's agenda items, the events in "Events") and the done/total progress of everything inside.
 */
export type TaskSection = {
  key: string;
  kind:
    | "agenda"
    | "meeting"
    | "events"
    | "event"
    | "other"
    | "person"
    | "unassigned"
    | "allMembers"
    | "due"
    | "all";
  /** agenda: the agenda item; meeting/event: the title; person: the name; due: the bucket. */
  title: string;
  /** meeting/event: the London day "YYYY-MM-DD" (null when unknown). */
  date?: string | null | undefined;
  /** meeting: the newest meeting (the only one open by default). */
  newest?: boolean | undefined;
  /** The task rows directly in this section (a meeting: the tasks not from one of its agenda items). */
  tasks: Task[];
  /** Nested sections, shown before this section's own rows. */
  children: TaskSection[];
  /** Done and total of every task inside, nested sections included. */
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
  extra: Partial<Pick<TaskSection, "date">> = {},
): TaskSection {
  return { key, kind, title, ...extra, tasks: [], children: [], done: 0, total: 0 };
}
function add(s: TaskSection, task: Task) {
  s.tasks.push(task);
  s.total += 1;
  if (task.status === "done") s.done += 1;
}
/** Adds the nested sections' progress to their parent. */
function withChildren(s: TaskSection, children: TaskSection[]) {
  s.children = children;
  for (const c of children) {
    s.done += c.done;
    s.total += c.total;
  }
  return s;
}

/** Milliseconds of an instant or a London date (for newest-first ordering); -Infinity when unknown. */
function when(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Where a task belongs in the Meeting grouping: its decision's agenda item, else its meeting, else its event (each only
 * when the caller can see it), else Other tasks.
 */
export function taskPlace(
  task: Pick<Task, "decision_id" | "meeting_id" | "event_id">,
  sources: TaskSources,
):
  | { kind: "agenda"; meetingId: string; agendaItemId: string }
  | { kind: "meeting"; meetingId: string }
  | { kind: "event"; eventId: string }
  | { kind: "other" } {
  const decision = task.decision_id
    ? sources.decisions.find((d) => d.id === task.decision_id)
    : undefined;
  if (decision)
    return {
      kind: "agenda",
      meetingId: decision.meeting_id,
      agendaItemId: decision.agenda_item_id,
    };
  if (task.meeting_id && sources.meetings.some((m) => m.id === task.meeting_id))
    return { kind: "meeting", meetingId: task.meeting_id };
  if (task.event_id && sources.events.some((e) => e.id === task.event_id))
    return { kind: "event", eventId: task.event_id };
  return { kind: "other" };
}

/** A task's decision on the Tasks page: its text ("Decision: …") and the later meetings it also shows in ("Also in: …"). */
export type DecisionInfo = {
  text: string | null;
  alsoIn: NonNullable<TaskSources["decisions"][number]["also_in"]>;
};
/** Decision id → text and later meetings. A task is listed once, under its own meeting; "Also in" names the others. */
export function decisionInfo(sources: TaskSources) {
  const map = new Map<string, DecisionInfo>();
  for (const d of sources.decisions)
    map.set(d.id, { text: d.text ?? null, alsoIn: d.also_in ?? [] });
  return map;
}

/** Decision id → decision text, for the "Decision: …" line under a task created from a decision. */
export function decisionTexts(sources: TaskSources) {
  const map = new Map<string, string>();
  for (const d of sources.decisions) if (d.text) map.set(d.id, d.text);
  return map;
}

/**
 * The Meeting grouping, nested:
 * - one section per meeting (newest first; title and date), holding its agenda items (agenda order) and then the
 *   meeting's tasks that come from no agenda item;
 * - "Events" (one section per event, newest first, undated last) for tasks linked to an event but no meeting;
 * - "Other tasks".
 * Rows keep their incoming order (groupTaskSections sorts them). Empty sections are dropped.
 */
export function meetingTree(
  tasks: readonly Task[],
  sources: TaskSources,
  labels: { events: string; other: string },
) {
  type MeetingAcc = { section: TaskSection; start: string | null; items: Map<string, TaskSection> };
  const meetings = new Map<string, MeetingAcc>();
  const events = new Map<string, TaskSection>();
  const eventStarts = new Map<string, string | null>();
  const other = section("other", "other", labels.other);
  const meetingInfo = (id: string) => {
    const m = sources.meetings.find((x) => x.id === id);
    if (m) return { title: m.title, start: m.starts_at };
    const d = sources.decisions.find((x) => x.meeting_id === id)!;
    return { title: d.meeting, start: d.starts_at };
  };
  const meetingAcc = (id: string) => {
    let acc = meetings.get(id);
    if (!acc) {
      const info = meetingInfo(id);
      acc = {
        section: section(`meeting:${id}`, "meeting", info.title, { date: sourceDay(info.start) }),
        start: info.start,
        items: new Map(),
      };
      meetings.set(id, acc);
    }
    return acc;
  };
  for (const t of tasks) {
    const place = taskPlace(t, sources);
    if (place.kind === "agenda") {
      const acc = meetingAcc(place.meetingId);
      let item = acc.items.get(place.agendaItemId);
      if (!item) {
        const d = sources.decisions.find((x) => x.agenda_item_id === place.agendaItemId)!;
        item = section(`agenda:${place.agendaItemId}`, "agenda", d.agenda_item);
        acc.items.set(place.agendaItemId, item);
      }
      add(item, t);
    } else if (place.kind === "meeting") add(meetingAcc(place.meetingId).section, t);
    else if (place.kind === "event") {
      let ev = events.get(place.eventId);
      if (!ev) {
        const e = sources.events.find((x) => x.id === place.eventId)!;
        ev = section(`event:${place.eventId}`, "event", e.title, { date: sourceDay(e.start) });
        eventStarts.set(ev.key, e.start);
        events.set(place.eventId, ev);
      }
      add(ev, t);
    } else add(other, t);
  }
  // Agenda order: where the agenda item first appears in the (agenda-ordered) decisions.
  const agendaRank = (key: string) =>
    sources.decisions.findIndex((d) => `agenda:${d.agenda_item_id}` === key);
  const meetingSections = [...meetings.values()]
    .sort(
      (a, b) =>
        when(b.start) - when(a.start) ||
        a.section.title.localeCompare(b.section.title) ||
        a.section.key.localeCompare(b.section.key),
    )
    .map((acc, i) => {
      const items = [...acc.items.values()].sort((a, b) => agendaRank(a.key) - agendaRank(b.key));
      const s = withChildren(acc.section, items);
      s.newest = i === 0;
      return s;
    });
  const eventSections = [...events.values()].sort(
    (a, b) =>
      when(eventStarts.get(b.key)) - when(eventStarts.get(a.key)) ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key),
  );
  const out = [...meetingSections];
  if (eventSections.length)
    out.push(withChildren(section("events", "events", labels.events), eventSections));
  if (other.total) out.push(other);
  return out;
}

/** Every section key in a (nested) list of sections, parents before their children. */
export function sectionKeys(sections: readonly TaskSection[]): string[] {
  return sections.flatMap((s) => [s.key, ...sectionKeys(s.children)]);
}

/**
 * The sections for a grouping, in a stable order; the rows inside every section (at every level) follow `sort`.
 * - meeting: see meetingTree;
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
  labels: {
    other: string;
    events: string;
    unassigned: string;
    allMembers: string;
    formerMember: string;
  },
  sort: TaskRowSort = "status",
): TaskSection[] {
  return sortSections(groupUnsorted(tasks, grouping, sources, today, labels), sort);
}

function sortSections(sections: TaskSection[], sort: TaskRowSort): TaskSection[] {
  for (const s of sections) {
    s.tasks = sortTaskRows(s.tasks, sort);
    sortSections(s.children, sort);
  }
  return sections;
}

function groupUnsorted(
  tasks: Task[],
  grouping: TaskGrouping,
  sources: TaskSources,
  today: string,
  labels: {
    other: string;
    events: string;
    unassigned: string;
    allMembers: string;
    formerMember: string;
  },
): TaskSection[] {
  if (grouping === "meeting") return meetingTree(tasks, sources, labels);
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

/**
 * Whether a section is collapsed: the user's own choice when there is one; otherwise a meeting other than the newest
 * one starts collapsed, and so does a section whose tasks are all done (not in the Archived view, where every task is
 * done).
 */
export function isCollapsed(
  s: Pick<TaskSection, "key" | "done" | "total"> & Partial<Pick<TaskSection, "kind" | "newest">>,
  remembered: Record<string, boolean>,
  autoCollapse = true,
) {
  if (s.key in remembered) return remembered[s.key]!;
  if (s.kind === "meeting" && !s.newest) return true;
  return autoCollapse && s.total > 0 && s.done === s.total;
}

/** "Expand all" / "Collapse all": every section key set to collapsed (true) or open (false), other keys kept. */
export function setAllCollapsed(
  remembered: Record<string, boolean>,
  sections: readonly TaskSection[],
  collapsed: boolean,
) {
  const keys = sectionKeys(sections);
  const rest = Object.fromEntries(Object.entries(remembered).filter(([k]) => !keys.includes(k)));
  return { ...rest, ...Object.fromEntries(keys.map((k) => [k, collapsed])) };
}

// ---------------------------------------------------------------------------------------------------------------
// Sort (inside every section): Status (then due date), Due date, Newest first, Oldest first (created).

export const TASK_ROW_SORTS = ["status", "due", "newest", "oldest"] as const;
export type TaskRowSort = (typeof TASK_ROW_SORTS)[number];

const dueKey = (t: Pick<Task, "due_date">) => t.due_date ?? "9999-12-31";
const statusRank = (t: Pick<Task, "status">) => TASK_STATUSES.indexOf(t.status);
const createdMs = (t: Pick<Task, "created_at">) => {
  const ms = Date.parse(t.created_at);
  return Number.isNaN(ms) ? 0 : ms;
};

/** The comparator of a sort; ties fall back to the due date, the title and the id (stable). */
export function compareTasks(sort: TaskRowSort) {
  return (
    a: Pick<Task, "id" | "title" | "status" | "due_date" | "created_at">,
    b: Pick<Task, "id" | "title" | "status" | "due_date" | "created_at">,
  ) => {
    const primary =
      sort === "status"
        ? statusRank(a) - statusRank(b)
        : sort === "newest"
          ? createdMs(b) - createdMs(a)
          : sort === "oldest"
            ? createdMs(a) - createdMs(b)
            : 0;
    return (
      primary ||
      dueKey(a).localeCompare(dueKey(b)) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
    );
  };
}
export function sortTaskRows<
  T extends Pick<Task, "id" | "title" | "status" | "due_date" | "created_at">,
>(tasks: readonly T[], sort: TaskRowSort) {
  return [...tasks].sort(compareTasks(sort));
}

// ---------------------------------------------------------------------------------------------------------------
// The "Created" date of a task: London day; the year only when it is not the current (London) year.

/** Intl options for a created date: "25 Nov" this year, "25 Nov 2025" in another year. */
export function createdDateOptions(createdAt: string, today: string): Intl.DateTimeFormatOptions {
  const day = sourceDay(createdAt);
  const sameYear = !!day && day.slice(0, 4) === today.slice(0, 4);
  return sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
}
/** The created date as text in a locale ("en-GB", "tr-TR"), London time. */
export function formatCreatedDate(createdAt: string, today: string, locale: string) {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Europe/London",
    ...createdDateOptions(createdAt, today),
  }).format(d);
}

// ---------------------------------------------------------------------------------------------------------------
// Remembered per user (per browser): the grouping and the sections the user collapsed or opened. Storage may be
// unavailable: then the defaults apply.

const groupingKey = (userId: string) => `dsvh-tasks-grouping:${userId}`;
const collapsedKey = (userId: string) => `dsvh-tasks-collapsed:${userId}`;

/** The remembered grouping; Meeting by default (an old "source" choice is the Meeting grouping now). */
export function readTaskGrouping(userId: string | undefined): TaskGrouping {
  if (!userId || typeof window === "undefined") return "meeting";
  try {
    const v = window.localStorage.getItem(groupingKey(userId));
    return (TASK_GROUPINGS as readonly string[]).includes(v ?? "")
      ? (v as TaskGrouping)
      : "meeting";
  } catch {
    return "meeting";
  }
}

const sortKey = (userId: string) => `dsvh-tasks-sort:${userId}`;
export function readTaskRowSort(userId: string | undefined): TaskRowSort {
  if (!userId || typeof window === "undefined") return "status";
  try {
    const v = window.localStorage.getItem(sortKey(userId));
    return (TASK_ROW_SORTS as readonly string[]).includes(v ?? "") ? (v as TaskRowSort) : "status";
  } catch {
    return "status";
  }
}
export function saveTaskRowSort(userId: string | undefined, sort: TaskRowSort) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sortKey(userId), sort);
  } catch {
    /* storage unavailable */
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
    // Keep the newest 500 entries (sections come and go with meetings and events).
    const entries = Object.entries(value).slice(-500);
    window.localStorage.setItem(collapsedKey(userId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage unavailable */
  }
}
