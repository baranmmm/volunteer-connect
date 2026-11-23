import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  TASK_STATUSES,
  addDays,
  groupTasks,
  isOverdue,
  type Task,
  type TaskGroup,
  type TaskStatus,
} from "@/lib/tasks";
import { dateLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BranchName } from "@/components/app/BranchName";
import { TaskPriorityBadge, TaskStatusBadge } from "./TaskBadges";
import { useSetTaskStatus } from "./use-task-status";
import { formatDay, selectClass } from "./task-display";

type ViewProps = { tasks: Task[]; today: string; onOpen: (id: string) => void };

function assigneeNames(task: Task, formerMember: string) {
  return task.assignees.map((a) => a.full_name ?? formerMember).join(", ");
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
        overdue ? "font-semibold text-destructive" : "text-muted-foreground",
      )}
    >
      {formatDay(task.due_date)}
      {overdue && ` · ${t("tasks.overdue")}`}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Kanban

export function KanbanView({ tasks, today, onOpen }: ViewProps) {
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
        const column = tasks.filter((x) => x.status === status);
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
              "flex min-w-0 flex-col gap-3 rounded-2xl border bg-muted/40 p-3",
              over === status && "ring-2 ring-primary",
            )}
          >
            <h2
              id={`tasks-kanban-${status}`}
              className="flex items-center justify-between px-1 font-semibold"
            >
              {t(`tasks.status.${status}`)}
              <span
                className="text-sm font-normal text-muted-foreground"
                data-testid="tasks-kanban-count"
              >
                {column.length}
              </span>
            </h2>
            {column.length === 0 && (
              <p className="px-1 py-4 text-center text-sm text-muted-foreground">
                {t("tasks.columnEmpty")}
              </p>
            )}
            {column.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
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

function TaskCard({
  task,
  today,
  onOpen,
  onDragStart,
  onDragEnd,
  onStatus,
}: {
  task: Task;
  today: string;
  onOpen: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStatus: (s: TaskStatus) => void;
}) {
  const { t } = useTranslation();
  const names = assigneeNames(task, t("common.formerMember"));
  return (
    <article
      data-testid="task-card"
      data-task-id={task.id}
      data-status={task.status}
      data-overdue={isOverdue(task, today)}
      draggable={task.can_set_status}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "min-w-0 space-y-2 rounded-xl border bg-card p-3 shadow-sm",
        task.can_set_status && "cursor-grab active:cursor-grabbing",
      )}
    >
      <button
        type="button"
        data-testid="task-card-open"
        onClick={() => onOpen(task.id)}
        className="block min-h-11 w-full min-w-0 text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="block truncate" title={task.title}>
          {task.title}
        </span>
      </button>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <TaskPriorityBadge priority={task.priority} />
        <DueText task={task} today={today} />
      </div>
      {names && (
        <p
          className="truncate text-xs text-muted-foreground"
          title={names}
          data-testid="task-card-assignees"
        >
          {names}
        </p>
      )}
      {task.can_set_status && (
        <select
          data-testid="task-card-status"
          aria-label={t("tasks.changeStatus", { title: task.title })}
          className={cn(selectClass, "h-11 text-sm")}
          value={task.status}
          onChange={(e) => onStatus(e.target.value as TaskStatus)}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.status.${s}`)}
            </option>
          ))}
        </select>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// List

export function ListView({ tasks, today, onOpen, group }: ViewProps & { group: TaskGroup }) {
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
              <span className="min-w-0 truncate" title={group === "status" ? undefined : g.label}>
                {group === "status" ? t(`tasks.status.${g.key}`) : g.label}
              </span>
              <span className="shrink-0 text-sm font-normal text-muted-foreground">
                ({g.tasks.length})
              </span>
            </h2>
          )}
          <ul className="min-w-0 divide-y rounded-2xl border bg-card">
            {g.tasks.map((task) => {
              const names = assigneeNames(task, t("common.formerMember"));
              return (
                <li key={task.id} className="min-w-0">
                  <button
                    type="button"
                    data-testid="tasks-list-row"
                    data-task-id={task.id}
                    data-status={task.status}
                    data-overdue={isOverdue(task, today)}
                    onClick={() => onOpen(task.id)}
                    className="grid min-h-11 w-full min-w-0 grid-cols-1 gap-2 px-4 py-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,10rem)] md:items-center md:gap-4"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium" title={task.title}>
                        {task.title}
                      </span>
                      {task.branch && (
                        <span className="block min-w-0 text-xs text-muted-foreground">
                          <BranchName name={task.branch} />
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <TaskStatusBadge status={task.status} />
                      <TaskPriorityBadge priority={task.priority} />
                    </span>
                    <span className="min-w-0">
                      {task.due_date ? (
                        <DueText task={task} today={today} />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("tasks.noDueDate")}
                        </span>
                      )}
                    </span>
                    <span
                      className="block min-w-0 truncate text-xs text-muted-foreground"
                      title={names}
                    >
                      {names || t("tasks.unassigned")}
                    </span>
                  </button>
                </li>
              );
            })}
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

export function CalendarView({ tasks, today, onOpen }: ViewProps) {
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
          onClick={() => onOpen(task.id)}
          title={task.title}
          className={cn(
            "block w-full min-w-0 truncate rounded-md border px-1.5 py-1 text-left text-xs hover:bg-muted",
            phone && "min-h-11 px-3 text-sm",
            overdue ? "border-destructive/40 bg-destructive/10 text-destructive" : "bg-card",
            task.status === "done" && "line-through opacity-70",
          )}
        >
          {task.title}
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
