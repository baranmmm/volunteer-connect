import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  UserCheck,
  Users,
} from "lucide-react";
import {
  TASK_STATUSES,
  addDays,
  archivableDoneIds,
  groupTasks,
  isOverdue,
  mineFirst,
  type Person,
  type Task,
  type TaskGroup,
  type TaskStatus,
} from "@/lib/tasks";
import { dateLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TaskPriorityBadge, TaskStatusBadge } from "./TaskBadges";
import { useSetTaskStatus } from "./use-task-status";
import { useTaskArchive } from "./use-task-archive";
import {
  TASK_MINE,
  TASK_OTHER,
  TASK_OTHER_TEXT,
  TASK_STATUS_BADGE,
  TASK_STATUS_CARD,
  TASK_STATUS_COLUMN,
} from "./task-status-colors";
import { formatDay, initials, scopeText } from "./task-display";

/**
 * `showScope`: scope labels (branch, region, national) are shown only to someone who can work in more than one place
 * (useWorkScopes().single is false); with a single scope every task comes from there.
 *
 * Every view uses compact one-line rows: title, a "Mine" marker, link icons (meeting, event), due date, assignee
 * initials and the status pill. The caller's own tasks stand out: an accent bar on the left, a light tint, a bold
 * title and the "Mine" marker.
 */
type ViewProps = {
  tasks: Task[];
  today: string;
  onOpen: (id: string) => void;
  showScope: boolean;
};

/** "Mine" marker on cards, rows and calendar items (shown when the list is not filtered to my tasks only). */
export function MineBadge({ testId, iconOnly = false }: { testId: string; iconOnly?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid={testId}
      title={t("tasks.mineHint")}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary font-semibold text-primary-foreground",
        iconOnly ? "p-0.5" : "px-2 py-0.5 text-xs",
      )}
    >
      <UserCheck className={iconOnly ? "size-3" : "size-3.5"} aria-hidden />
      <span className={iconOnly ? "sr-only" : undefined}>{t("tasks.mine")}</span>
    </span>
  );
}

/** Assignee initials (at most two, then "+N"); the names are in the tooltip and for screen readers. */
export function AssigneeAvatars({
  people,
  testId,
  className,
}: {
  people: Pick<Person, "id" | "full_name">[];
  testId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!people.length) return null;
  const name = (p: Pick<Person, "full_name">) => p.full_name ?? t("common.formerMember");
  const names = people.map(name).join(", ");
  const shown = people.slice(0, 2);
  const rest = people.length - shown.length;
  const dot =
    "inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold leading-none text-foreground";
  return (
    <span
      data-testid={testId}
      data-count={people.length}
      title={names}
      className={cn("flex shrink-0 -space-x-1.5", className)}
    >
      {shown.map((p) => (
        <span key={p.id} className={dot} aria-hidden>
          {initials(p.full_name)}
        </span>
      ))}
      {rest > 0 && (
        <span className={dot} aria-hidden>
          +{rest}
        </span>
      )}
      <span className="sr-only">{names}</span>
    </span>
  );
}

/** Small icons for a task linked to a meeting and/or an event. */
export function TaskLinkIcons({ task }: { task: Pick<Task, "meeting_id" | "event_id"> }) {
  const { t } = useTranslation();
  if (!task.meeting_id && !task.event_id) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground dark:text-inherit">
      {task.meeting_id && (
        <span data-testid="task-link-meeting" title={t("tasks.links.meeting")}>
          <Users className="size-3.5" aria-hidden />
          <span className="sr-only">{t("tasks.links.meeting")}</span>
        </span>
      )}
      {task.event_id && (
        <span data-testid="task-link-event" title={t("tasks.links.event")}>
          <CalendarDays className="size-3.5" aria-hidden />
          <span className="sr-only">{t("tasks.links.event")}</span>
        </span>
      )}
    </span>
  );
}

/** Unarchive from a card or row (archived tasks are listed only under the "Archived" filter). */
function UnarchiveButton({ task }: { task: Task }) {
  const { t } = useTranslation();
  const archive = useTaskArchive();
  const [busy, setBusy] = useState(false);
  if (!task.archived_at || !task.can_set_status) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-9"
      data-testid="task-card-unarchive"
      disabled={busy}
      aria-label={t("tasks.archive.unarchiveTitle", { title: task.title })}
      onClick={async () => {
        setBusy(true);
        await archive.setArchived(task.id, false);
        setBusy(false);
      }}
    >
      <ArchiveRestore />
      {t("tasks.archive.unarchive")}
    </Button>
  );
}

/** "Archive all done" for the given tasks (the done ones the caller may change); hidden when there are none. */
export function ArchiveDoneButton({ tasks, testId }: { tasks: Task[]; testId: string }) {
  const { t } = useTranslation();
  const archive = useTaskArchive();
  const [busy, setBusy] = useState(false);
  const ids = archivableDoneIds(tasks);
  if (!ids.length) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-11 bg-card"
      data-testid={testId}
      data-count={ids.length}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await archive.archiveDone(ids);
        setBusy(false);
      }}
    >
      <Archive />
      {t("tasks.archive.archiveAllDone", { count: ids.length })}
    </Button>
  );
}

function DueText({ task, today }: { task: Task; today: string }) {
  const { t } = useTranslation();
  if (!task.due_date) return null;
  const overdue = isOverdue(task, today);
  return (
    <span
      data-testid="task-due"
      data-overdue={overdue}
      className={cn(
        "whitespace-nowrap text-xs",
        overdue ? "font-semibold text-destructive" : "text-muted-foreground dark:text-inherit",
      )}
    >
      {formatDay(task.due_date)}
      {overdue && ` · ${t("tasks.overdue")}`}
    </span>
  );
}

function NoteCount({ task }: { task: Task }) {
  const { t } = useTranslation();
  if (task.note_count <= 0) return null;
  return (
    <span
      data-testid="task-card-notes"
      data-count={task.note_count}
      className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground dark:text-inherit"
      title={t("tasks.notes.count", { count: task.note_count })}
    >
      <MessageSquare className="size-3.5" aria-hidden />
      <span aria-hidden>{task.note_count}</span>
      <span className="sr-only">{t("tasks.notes.count", { count: task.note_count })}</span>
    </span>
  );
}

/** Priority is shown on compact rows only when it asks for attention (high, urgent). */
function LoudPriority({ task }: { task: Task }) {
  if (task.priority !== "high" && task.priority !== "urgent") return null;
  return <TaskPriorityBadge priority={task.priority} className="px-1.5 py-0 text-[11px]" />;
}

// ---------------------------------------------------------------------------------------------------------------
// Kanban

export function KanbanView({
  tasks,
  today,
  onOpen,
  markMine,
  showScope,
}: ViewProps & { markMine: boolean }) {
  const { t } = useTranslation();
  const setStatus = useSetTaskStatus();
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  return (
    <div
      data-testid="tasks-kanban"
      className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {TASK_STATUSES.map((status) => {
        // The caller's own tasks first in every column.
        const column = mineFirst(tasks.filter((x) => x.status === status));
        return (
          <section
            key={status}
            data-testid="tasks-kanban-column"
            data-status={status}
            aria-labelledby={`tasks-kanban-${status}`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(status);
            }}
            onDragLeave={() => setOver((cur) => (cur === status ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              const task = dragging;
              setDragging(null);
              setOver(null);
              if (task && task.can_set_status && task.status !== status)
                void setStatus(task.id, status);
            }}
            className={cn(
              "flex min-w-0 flex-col gap-2 rounded-2xl border p-2.5",
              TASK_STATUS_COLUMN[status],
              over === status && "ring-2 ring-primary",
            )}
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
              <h2
                id={`tasks-kanban-${status}`}
                className="flex min-w-0 items-center gap-2 font-semibold"
              >
                {t(`tasks.status.${status}`)}
                <span
                  className="text-sm font-normal text-muted-foreground dark:text-inherit"
                  data-testid="tasks-kanban-count"
                >
                  {column.length}
                </span>
              </h2>
              {status === "done" && (
                <ArchiveDoneButton tasks={column} testId="tasks-kanban-archive-done" />
              )}
            </div>
            {column.length === 0 && (
              <p className="px-1 py-3 text-center text-sm text-muted-foreground">
                {t("tasks.columnEmpty")}
              </p>
            )}
            {column.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                markMine={markMine}
                showScope={showScope}
                today={today}
                onOpen={onOpen}
                onDragStart={() => setDragging(task)}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onStatus={(s) => void setStatus(task.id, s)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** The status pill of a card: a small select in the status colours (the keyboard alternative to dragging). */
function StatusPillSelect({
  task,
  onStatus,
  testId,
}: {
  task: Task;
  onStatus: (s: TaskStatus) => void;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <select
      data-testid={testId}
      aria-label={t("tasks.changeStatus", { title: task.title })}
      className={cn(
        "h-9 max-w-[9rem] shrink-0 cursor-pointer rounded-full border px-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        TASK_STATUS_BADGE[task.status],
      )}
      value={task.status}
      onChange={(e) => onStatus(e.target.value as TaskStatus)}
    >
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {t(`tasks.status.${s}`)}
        </option>
      ))}
    </select>
  );
}

function TaskCard({
  task,
  markMine,
  showScope,
  today,
  onOpen,
  onDragStart,
  onDragEnd,
  onStatus,
}: {
  task: Task;
  markMine: boolean;
  showScope: boolean;
  today: string;
  onOpen: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStatus: (s: TaskStatus) => void;
}) {
  const { t } = useTranslation();
  const changeable = task.can_set_status && !task.archived_at;
  return (
    <article
      data-testid="task-card"
      data-task-id={task.id}
      data-status={task.status}
      data-overdue={isOverdue(task, today)}
      data-mine={task.mine}
      data-archived={!!task.archived_at}
      draggable={changeable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "min-w-0 rounded-lg border px-2.5 py-1.5 shadow-sm",
        TASK_STATUS_CARD[task.status],
        task.mine ? TASK_MINE : TASK_OTHER,
        changeable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          data-testid="task-card-open"
          onClick={() => onOpen(task.id)}
          className={cn(
            "block min-h-9 min-w-0 flex-1 text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            task.mine ? "font-bold" : cn("font-normal", TASK_OTHER_TEXT),
          )}
        >
          <span className="block truncate" title={task.title}>
            {task.title}
          </span>
        </button>
        {markMine && task.mine && <MineBadge testId="task-card-mine" />}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <TaskLinkIcons task={task} />
          <LoudPriority task={task} />
          <DueText task={task} today={today} />
          <NoteCount task={task} />
          {showScope && (
            <span
              className="min-w-0 truncate text-xs text-muted-foreground dark:text-inherit"
              data-testid="task-card-scope"
              data-scope={task.scope}
              title={scopeText(t, task)}
            >
              {scopeText(t, task)}
            </span>
          )}
        </span>
        <AssigneeAvatars people={task.assignees} testId="task-card-assignees" />
        {changeable ? (
          <StatusPillSelect task={task} onStatus={onStatus} testId="task-card-status" />
        ) : (
          <TaskStatusBadge status={task.status} className="rounded-full" />
        )}
      </div>
      {task.archived_at && task.can_set_status && (
        <div className="pt-1.5">
          <UnarchiveButton task={task} />
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// List

export function ListView({
  tasks,
  today,
  onOpen,
  group,
  markMine,
  showScope,
}: ViewProps & { group: TaskGroup; markMine: boolean }) {
  const { t } = useTranslation();
  const groups = groupTasks(tasks, group, t("tasks.unassigned"));
  return (
    <div data-testid="tasks-list" className="min-w-0 space-y-6">
      {groups.map((g) => (
        <section
          key={g.key}
          data-testid="tasks-list-group"
          data-group={g.key}
          className="min-w-0 space-y-2"
        >
          {group !== "none" && (
            <h2 className="flex min-w-0 items-center gap-2 font-semibold">
              <span className="min-w-0 truncate" title={group === "assignee" ? g.label : undefined}>
                {group === "status"
                  ? t(`tasks.status.${g.key}`)
                  : group === "mine"
                    ? t(g.label)
                    : g.label}
              </span>
              <span className="shrink-0 text-sm font-normal text-muted-foreground">
                ({g.tasks.length})
              </span>
              {group === "status" && g.key === "done" && (
                <span className="ml-auto">
                  <ArchiveDoneButton tasks={g.tasks} testId="tasks-list-archive-done" />
                </span>
              )}
            </h2>
          )}
          <ul className="min-w-0 divide-y overflow-hidden rounded-2xl border bg-card">
            {g.tasks.map((task) => (
              <li
                key={task.id}
                className={cn("flex min-w-0 items-center", task.mine ? TASK_MINE : TASK_OTHER)}
              >
                <button
                  type="button"
                  data-testid="tasks-list-row"
                  data-task-id={task.id}
                  data-status={task.status}
                  data-overdue={isOverdue(task, today)}
                  data-mine={task.mine}
                  data-archived={!!task.archived_at}
                  onClick={() => onOpen(task.id)}
                  className="flex min-h-11 w-full min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex-nowrap"
                >
                  <span className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
                    <span
                      className={cn(
                        "min-w-0 truncate text-sm",
                        task.mine ? "font-bold" : cn("font-normal", TASK_OTHER_TEXT),
                      )}
                      title={task.title}
                    >
                      {task.title}
                    </span>
                    {markMine && task.mine && <MineBadge testId="tasks-list-row-mine" />}
                    {showScope && (
                      <span
                        className="min-w-0 shrink truncate text-xs text-muted-foreground"
                        data-testid="tasks-list-row-scope"
                        data-scope={task.scope}
                        title={scopeText(t, task)}
                      >
                        {scopeText(t, task)}
                      </span>
                    )}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <TaskLinkIcons task={task} />
                    <LoudPriority task={task} />
                    <NoteCount task={task} />
                    {task.due_date ? (
                      <DueText task={task} today={today} />
                    ) : (
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {t("tasks.noDueDate")}
                      </span>
                    )}
                    {task.assignees.length ? (
                      <AssigneeAvatars people={task.assignees} testId="tasks-list-row-assignees" />
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("tasks.unassigned")}</span>
                    )}
                    <TaskStatusBadge status={task.status} className="rounded-full" />
                  </span>
                </button>
                {task.archived_at && task.can_set_status && (
                  <div className="shrink-0 pr-3">
                    <UnarchiveButton task={task} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Calendar (London days, weeks start on Monday)

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

/** Monday-first weeks covering the month (YYYY-MM). */
function monthDays(month: string) {
  const first = `${month}-01`;
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  let day = addDays(first, -weekday);
  const days: string[] = [];
  while (days.length < 42) {
    days.push(day);
    day = addDays(day, 1);
    if (days.length % 7 === 0 && day.slice(0, 7) > month) break;
  }
  return days;
}

function shiftMonth(month: string, by: number) {
  const d = new Date(`${month}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

export function CalendarView({ tasks, today, onOpen, showScope }: ViewProps) {
  const { t, i18n } = useTranslation();
  const phone = useIsPhone();
  const [month, setMonth] = useState(today.slice(0, 7));
  const days = useMemo(() => monthDays(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.due_date) continue;
      map.set(task.due_date, [...(map.get(task.due_date) ?? []), task]);
    }
    // The caller's own tasks first on every day.
    for (const [day, list] of map) map.set(day, mineFirst(list));
    return map;
  }, [tasks]);
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(dateLocale(i18n.language), {
      weekday: "short",
      timeZone: "UTC",
    });
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i, 12))));
  }, [i18n.language]);
  const undated = tasks.filter((x) => !x.due_date).length;

  const item = (task: Task) => {
    const overdue = isOverdue(task, today);
    return (
      <li key={task.id} className="min-w-0">
        <button
          type="button"
          data-testid="tasks-calendar-item"
          data-task-id={task.id}
          data-overdue={overdue}
          data-mine={task.mine}
          onClick={() => onOpen(task.id)}
          title={showScope ? `${task.title} · ${scopeText(t, task)}` : task.title}
          className={cn(
            "group flex w-full min-w-0 items-center gap-1 rounded-md border px-1.5 py-1 text-left text-xs hover:bg-muted",
            phone && "min-h-11 px-3 text-sm",
            overdue ? "border-destructive/40 bg-destructive/10 text-destructive" : "bg-card",
            task.mine ? cn(TASK_MINE, "font-bold") : !overdue && TASK_OTHER_TEXT,
            task.status === "done" && "line-through",
          )}
        >
          {task.mine && <MineBadge testId="tasks-calendar-item-mine" iconOnly />}
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          {showScope && (
            <span className="sr-only" data-testid="tasks-calendar-item-scope">
              {` · ${scopeText(t, task)}`}
            </span>
          )}
        </button>
      </li>
    );
  };

  const monthDaysWithTasks = days.filter((d) => d.slice(0, 7) === month && byDay.has(d));

  return (
    <section data-testid="tasks-calendar" data-month={month} className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          data-testid="tasks-calendar-previous"
          aria-label={t("tasks.calendar.previous")}
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
        >
          <ChevronLeft />
        </Button>
        <h2 className="text-lg font-semibold" data-testid="tasks-calendar-title" aria-live="polite">
          {formatDay(`${month}-01`, { month: "long", year: "numeric" })}
        </h2>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          data-testid="tasks-calendar-next"
          aria-label={t("tasks.calendar.next")}
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      {phone ? (
        monthDaysWithTasks.length ? (
          <ol className="min-w-0 space-y-4" data-testid="tasks-calendar-agenda">
            {monthDaysWithTasks.map((d) => (
              <li
                key={d}
                data-testid="tasks-calendar-day"
                data-day={d}
                className="min-w-0 space-y-2"
              >
                <h3 className={cn("text-sm font-semibold", d === today && "text-primary")}>
                  {formatDay(d, { weekday: "long", day: "numeric", month: "long" })}
                </h3>
                <ul className="min-w-0 space-y-1">{byDay.get(d)!.map(item)}</ul>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-8 text-center text-muted-foreground" data-testid="tasks-calendar-empty">
            {t("tasks.calendar.empty")}
          </p>
        )
      ) : (
        <div className="min-w-0 overflow-hidden rounded-2xl border">
          <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
            {weekdays.map((w) => (
              <div key={w} className="py-2">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const inMonth = d.slice(0, 7) === month;
              return (
                <div
                  key={d}
                  data-testid="tasks-calendar-day"
                  data-day={d}
                  className={cn(
                    "min-h-24 min-w-0 space-y-1 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0",
                    !inMonth && "bg-muted/30 text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs",
                      d === today && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {Number(d.slice(8))}
                  </span>
                  {byDay.has(d) && <ul className="min-w-0 space-y-1">{byDay.get(d)!.map(item)}</ul>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {undated > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="tasks-calendar-undated">
          {t("tasks.calendar.undated", { count: undated })}
        </p>
      )}
    </section>
  );
}
