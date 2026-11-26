import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  MoreHorizontal,
  UserCheck,
  Users,
} from "lucide-react";
import {
  TASK_STATUSES,
  addDays,
  archivableDoneIds,
  isOverdue,
  mineFirst,
  type Task,
  type TaskStatus,
} from "@/lib/tasks";
import { isCollapsed, type TaskGrouping, type TaskSection } from "@/lib/task-grouping";
import { dateLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { createdDay, formatDay, scopeText, sectionLabel } from "./task-display";
import { AssigneeNames } from "./AssigneeNames";
import { TaskGroupMembers, TaskGroupProgress } from "./TaskGroupParts";

/**
 * `showScope`: scope labels (branch, region, national) are shown only to someone who can work in more than one place
 * (useWorkScopes().single is false); with a single scope every task comes from there.
 *
 * Every view uses compact rows: title (and the decision it comes from), link icons (meeting, event), the created date
 * (wide screens), due date, assignee names and the status. The
 * caller's own tasks stand out by an accent bar on the left, a light tint and a bold title (screen readers hear
 * "your task"); the calendar adds a small icon.
 */
type ViewProps = {
  tasks: Task[];
  today: string;
  onOpen: (id: string) => void;
  showScope: boolean;
};

/** "Created 25 Nov" on wide screens (hidden on phones, where the row has no room). */
function CreatedText({ task, today }: { task: Task; today: string }) {
  const { t } = useTranslation();
  const date = createdDay(task.created_at, today);
  if (!date) return null;
  return (
    <span
      data-testid="task-created"
      className="hidden shrink-0 whitespace-nowrap text-xs text-muted-foreground md:inline dark:text-inherit"
    >
      {t("tasks.created", { date })}
    </span>
  );
}

/** "Decision: …" under a task created from a meeting decision: one line, the full text on hover and focus. */
function DecisionLine({ text, testId }: { text: string | undefined; testId: string }) {
  const { t } = useTranslation();
  if (!text) return null;
  const line = t("tasks.decisionLine", { text });
  return (
    <span
      data-testid={testId}
      title={line}
      className="block min-w-0 truncate text-xs font-normal text-muted-foreground group-focus-visible:whitespace-normal dark:text-inherit"
    >
      {line}
    </span>
  );
}

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
        "relative whitespace-nowrap text-xs",
        overdue ? "font-semibold text-destructive" : "text-muted-foreground dark:text-inherit",
      )}
    >
      <span className="sm:hidden">
        {formatDay(task.due_date, { day: "numeric", month: "short" })}
      </span>
      <span className="hidden sm:inline">{formatDay(task.due_date)}</span>
      {overdue && (
        <>
          <span className="hidden sm:inline">{` · ${t("tasks.overdue")}`}</span>
          <span className="sr-only sm:hidden">{` · ${t("tasks.overdue")}`}</span>
        </>
      )}
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
// Sections (Group by): a collapsible header with done/total and a mini progress bar

const SECTION_ICONS = {
  agenda: Users,
  meeting: Users,
  events: CalendarDays,
  event: CalendarDays,
} as const;

function SectionHeader({
  section,
  collapsed,
  onToggle,
  bodyId,
  depth,
  className,
}: {
  section: TaskSection;
  collapsed: boolean;
  onToggle: () => void;
  bodyId: string;
  /** 0 for a top-level section (h2), 1 for a nested one (h3), and so on. */
  depth: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = sectionLabel(t, section);
  const text = section.kind === "due" ? label : section.title;
  const Icon =
    section.kind === "agenda" ||
    section.kind === "meeting" ||
    section.kind === "events" ||
    section.kind === "event"
      ? SECTION_ICONS[section.kind]
      : null;
  const pct = section.total ? Math.round((section.done / section.total) * 100) : 0;
  const Heading = depth === 0 ? "h2" : depth === 1 ? "h3" : "h4";
  return (
    <Heading className={cn("min-w-0", className)}>
      <button
        type="button"
        data-testid="tasks-section-toggle"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={onToggle}
        className={cn(
          "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          depth > 0 && "min-h-10",
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-transform motion-reduce:transition-none",
            !collapsed && "rotate-90",
          )}
        />
        {Icon && <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        <span
          data-testid="tasks-section-label"
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            depth === 0 ? "font-semibold" : "font-medium",
          )}
          title={label}
        >
          {text}
          {section.date && (
            <span
              data-testid="tasks-section-date"
              className="ml-2 text-xs font-normal text-muted-foreground"
            >
              {formatDay(section.date)}
            </span>
          )}
        </span>
        <span
          data-testid="tasks-section-progress"
          data-done={section.done}
          data-total={section.total}
          className="relative flex shrink-0 items-center gap-2 text-xs font-normal text-muted-foreground"
        >
          <span
            aria-hidden
            className={cn(
              "hidden h-1.5 overflow-hidden rounded-full bg-muted sm:block",
              section.kind === "meeting" ? "w-16" : "w-10",
            )}
          >
            <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </span>
          <span aria-hidden>
            {section.done}/{section.total}
          </span>
          <span className="sr-only">
            {t("tasks.grouping.progress", { done: section.done, total: section.total })}
          </span>
        </span>
      </button>
    </Heading>
  );
}

const sectionDomId = (prefix: string, key: string) =>
  `${prefix}-${key.replace(/[^a-z0-9-]/gi, "-")}`;

type SectionProps = {
  sections: TaskSection[];
  /** The section keys the user collapsed or opened (anything else: collapsed only when all done). */
  remembered: Record<string, boolean>;
  onToggle: (key: string, collapsed: boolean) => void;
  grouping: TaskGrouping;
  /** All-done sections start collapsed (off in the Archived view). */
  autoCollapse: boolean;
  /** Decision id → text, for the "Decision: …" line. */
  decisions: Map<string, string>;
};

/** The status of a task as a small menu: a pill (list rows) or a "…" button (board cards). */
function StatusMenu({
  task,
  onStatus,
  testId,
  variant,
}: {
  task: Task;
  onStatus: (s: TaskStatus) => void;
  testId: string;
  variant: "pill" | "more";
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "pill" ? (
          <button
            type="button"
            data-testid={testId}
            data-status={task.status}
            aria-label={t("tasks.changeStatus", { title: task.title })}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              TASK_STATUS_BADGE[task.status],
            )}
          >
            {t(`tasks.status.${task.status}`)}
            <ChevronDown aria-hidden className="size-3" />
          </button>
        ) : (
          <button
            type="button"
            data-testid={testId}
            aria-label={t("tasks.changeStatus", { title: task.title })}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-inherit"
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={task.status}
          onValueChange={(v) => v !== task.status && onStatus(v as TaskStatus)}
        >
          {TASK_STATUSES.map((s) => (
            <DropdownMenuRadioItem
              key={s}
              value={s}
              data-testid="task-status-option"
              data-status={s}
            >
              {t(`tasks.status.${s}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Screen-reader text for the caller's own task (seen as the accent bar and bold title). */
function MineText() {
  const { t } = useTranslation();
  return <span className="sr-only">{` (${t("tasks.mineHint")})`}</span>;
}

// ---------------------------------------------------------------------------------------------------------------
// Board: the four status columns; with a grouping, one collapsible swimlane per section across them

export function KanbanView({
  tasks,
  today,
  onOpen,
  showScope,
  sections,
  remembered,
  onToggle,
  grouping,
  autoCollapse,
  decisions,
}: ViewProps & SectionProps) {
  const { t } = useTranslation();
  const setStatus = useSetTaskStatus();
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const cell = (section: TaskSection, status: TaskStatus) => {
    // The caller's own tasks first in every cell.
    const column = mineFirst(section.tasks.filter((x) => x.status === status));
    const id = `${section.key}|${status}`;
    return (
      <div
        key={status}
        data-testid="tasks-kanban-column"
        data-status={status}
        data-section={section.key}
        aria-label={`${t(`tasks.status.${status}`)}${grouping === "none" ? "" : ` · ${sectionLabel(t, section)}`}`}
        role="group"
        onDragOver={(e) => {
          if (!dragging) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(id);
        }}
        onDragLeave={() => setOver((cur) => (cur === id ? null : cur))}
        onDrop={(e) => {
          e.preventDefault();
          const task = dragging;
          setDragging(null);
          setOver(null);
          if (task && task.can_set_status && task.status !== status)
            void setStatus(task.id, status);
        }}
        className={cn(
          "flex min-h-14 min-w-0 flex-col gap-1.5 rounded-xl border p-1.5",
          TASK_STATUS_COLUMN[status],
          over === id && "ring-2 ring-primary",
        )}
      >
        {column.map((task) =>
          task.group ? (
            <GroupCard
              key={task.id}
              task={task}
              showScope={showScope}
              today={today}
              onOpen={onOpen}
            />
          ) : (
            <TaskCard
              key={task.id}
              task={task}
              decision={task.decision_id ? decisions.get(task.decision_id) : undefined}
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
          ),
        )}
      </div>
    );
  };
  const totals = TASK_STATUSES.map((s) => tasks.filter((x) => x.status === s));
  // One swimlane per section; nested sections (a meeting's agenda items, the events) inside their parent's lane.
  const lane = (section: TaskSection, depth: number): ReactNode => {
    const collapsed = grouping !== "none" && isCollapsed(section, remembered, autoCollapse);
    const bodyId = sectionDomId("tasks-lane", section.key);
    return (
      <section
        key={section.key}
        data-testid="tasks-section"
        data-section-key={section.key}
        data-kind={section.kind}
        data-depth={depth}
        data-collapsed={collapsed}
        className="min-w-0 space-y-1.5"
      >
        {grouping !== "none" && (
          <SectionHeader
            section={section}
            collapsed={collapsed}
            bodyId={bodyId}
            depth={depth}
            onToggle={() => onToggle(section.key, !collapsed)}
            className="border-b"
          />
        )}
        <div id={bodyId} hidden={collapsed} className="min-w-0 space-y-2">
          {!collapsed && (
            <>
              {section.children.length > 0 && (
                <div className="min-w-0 space-y-2 border-l pl-1.5 sm:ml-2 sm:pl-3">
                  {section.children.map((c) => lane(c, depth + 1))}
                </div>
              )}
              {section.tasks.length > 0 && (
                <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
                  {TASK_STATUSES.map((status) => cell(section, status))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    );
  };
  return (
    <div data-testid="tasks-kanban" data-grouping={grouping} className="min-w-0 space-y-2">
      <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
        {TASK_STATUSES.map((status, i) => (
          <div
            key={status}
            data-testid="tasks-kanban-heading"
            data-status={status}
            className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1.5"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              {t(`tasks.status.${status}`)}
              <span className="font-normal text-muted-foreground" data-testid="tasks-kanban-count">
                {totals[i]!.length}
              </span>
            </span>
            {status === "done" && (
              <ArchiveDoneButton tasks={totals[i]!} testId="tasks-kanban-archive-done" />
            )}
          </div>
        ))}
      </div>
      {sections.map((section) => lane(section, 0))}
    </div>
  );
}

/**
 * A board card: the title (up to two lines, never cut to a few characters), then due date, link icons and initials,
 * and a "…" menu for the status (the column is the status; dragging between columns changes it too).
 */
function TaskCard({
  task,
  decision,
  showScope,
  today,
  onOpen,
  onDragStart,
  onDragEnd,
  onStatus,
}: {
  task: Task;
  decision: string | undefined;
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
        "min-w-0 rounded-lg border px-2 py-1 shadow-sm",
        TASK_STATUS_CARD[task.status],
        task.mine ? TASK_MINE : TASK_OTHER,
        changeable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          data-testid="task-card-open"
          onClick={() => onOpen(task.id)}
          className={cn(
            "group relative block min-h-8 min-w-0 flex-1 py-0.5 text-left text-sm leading-snug hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            task.mine ? "font-bold" : cn("font-normal", TASK_OTHER_TEXT),
          )}
        >
          <span
            data-testid="task-card-title"
            className="line-clamp-2 break-words"
            title={task.title}
          >
            {task.title}
          </span>
          {task.mine && <MineText />}
          <DecisionLine text={decision} testId="task-card-decision" />
        </button>
        {changeable && (
          <StatusMenu task={task} onStatus={onStatus} testId="task-card-menu" variant="more" />
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
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
        <AssigneeNames people={task.assignees} testId="task-card-assignees" />
      </div>
      {task.archived_at && task.can_set_status && (
        <div className="pt-1">
          <UnarchiveButton task={task} />
        </div>
      )}
    </article>
  );
}

/**
 * One card for a whole "@all" group (Board): placed by its derived status, not draggable (each member changes their
 * own task). It opens the group panel.
 */
function GroupCard({
  task,
  showScope,
  today,
  onOpen,
}: {
  task: Task;
  showScope: boolean;
  today: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const group = task.group!;
  return (
    <article
      data-testid="task-group-card"
      data-group-id={group.id}
      data-status={task.status}
      data-overdue={isOverdue(task, today)}
      data-archived={!!task.archived_at}
      className={cn(
        "min-w-0 rounded-lg border border-dashed px-2 py-1",
        TASK_STATUS_CARD[task.status],
        TASK_OTHER,
      )}
    >
      <button
        type="button"
        data-testid="task-group-card-open"
        onClick={() => onOpen(group.id)}
        className={cn(
          "block min-h-8 w-full min-w-0 py-0.5 text-left text-sm font-normal leading-snug hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          TASK_OTHER_TEXT,
        )}
      >
        <span className="line-clamp-2 break-words" title={task.title}>
          {task.title}
        </span>
      </button>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pb-0.5">
        <TaskGroupProgress group={group} compact className="flex-1" />
        <TaskLinkIcons task={task} />
        <DueText task={task} today={today} />
        {showScope && (
          <span
            className="min-w-0 truncate text-xs text-muted-foreground dark:text-inherit"
            data-testid="task-card-scope"
            data-scope={task.scope}
          >
            {scopeText(t, task)}
          </span>
        )}
      </div>
    </article>
  );
}

/** A group row in the list: the progress, and a toggle that shows each member's task and status. */
function GroupListRow({
  task,
  today,
  showScope,
  onOpen,
}: {
  task: Task;
  today: string;
  showScope: boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const group = task.group!;
  const [open, setOpen] = useState(false);
  const bodyId = `task-group-row-body-${group.id}`;
  return (
    <li
      className={cn("min-w-0", TASK_OTHER)}
      data-testid="task-group-row"
      data-group-id={group.id}
      data-status={task.status}
      data-archived={!!task.archived_at}
    >
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          data-testid="task-group-row-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={t(open ? "tasks.groups.collapse" : "tasks.groups.expand", {
            title: task.title,
          })}
          onClick={() => setOpen((v) => !v)}
          className="flex size-10 shrink-0 items-center justify-center hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn("size-4 transition-transform", open && "rotate-90")}
            aria-hidden
          />
        </button>
        <button
          type="button"
          data-testid="task-group-row-open"
          onClick={() => onOpen(group.id)}
          className="flex min-h-10 w-full min-w-0 flex-1 items-center gap-2 py-1 pr-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn("min-w-0 flex-1 truncate text-sm font-normal", TASK_OTHER_TEXT)}
            title={task.title}
          >
            {task.title}
          </span>
          {showScope && (
            <span
              className="hidden min-w-0 max-w-[12rem] shrink truncate text-xs text-muted-foreground lg:inline"
              data-testid="tasks-list-row-scope"
              data-scope={task.scope}
            >
              {scopeText(t, task)}
            </span>
          )}
          <TaskGroupProgress group={group} compact className="hidden shrink-0 sm:flex" />
          <TaskLinkIcons task={task} />
          <DueText task={task} today={today} />
          <TaskStatusBadge status={task.status} className="rounded-full px-2 py-0 text-[11px]" />
        </button>
      </div>
      <div id={bodyId} hidden={!open} className="px-3 pb-2 pl-10">
        {open && (
          <TaskGroupMembers
            group={group}
            taskLink={(id) => ({ to: "/tasks", search: { task: id } })}
          />
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// List: one line per task inside collapsible sections

export function ListView({
  today,
  onOpen,
  showScope,
  sections,
  remembered,
  onToggle,
  grouping,
  autoCollapse,
  decisions,
}: ViewProps & SectionProps) {
  const setStatus = useSetTaskStatus();
  const render = (section: TaskSection, depth: number): ReactNode => {
    const collapsed = grouping !== "none" && isCollapsed(section, remembered, autoCollapse);
    const bodyId = sectionDomId("tasks-section", section.key);
    return (
      <section
        key={section.key}
        data-testid="tasks-section"
        data-section-key={section.key}
        data-kind={section.kind}
        data-depth={depth}
        data-collapsed={collapsed}
        className="min-w-0"
      >
        {grouping !== "none" && (
          <SectionHeader
            section={section}
            collapsed={collapsed}
            bodyId={bodyId}
            depth={depth}
            onToggle={() => onToggle(section.key, !collapsed)}
          />
        )}
        <div id={bodyId} hidden={collapsed} className="mt-1 min-w-0 space-y-1">
          {!collapsed && (
            <>
              {section.children.length > 0 && (
                <div
                  data-testid="tasks-section-children"
                  className="ml-2 min-w-0 space-y-1 border-l pl-1.5 sm:ml-3 sm:pl-3"
                >
                  {section.children.map((c) => render(c, depth + 1))}
                </div>
              )}
              {section.tasks.length > 0 && (
                <ul
                  className={cn(
                    "min-w-0 divide-y overflow-hidden rounded-xl border bg-card",
                    section.children.length > 0 && "ml-2 sm:ml-3",
                  )}
                >
                  {section.tasks.map((task) =>
                    task.group ? (
                      <GroupListRow
                        key={task.id}
                        task={task}
                        today={today}
                        showScope={showScope}
                        onOpen={onOpen}
                      />
                    ) : (
                      <TaskListRow
                        key={task.id}
                        task={task}
                        today={today}
                        showScope={showScope}
                        onOpen={onOpen}
                        decision={task.decision_id ? decisions.get(task.decision_id) : undefined}
                        onStatus={(st) => void setStatus(task.id, st)}
                      />
                    ),
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
    );
  };
  return (
    <div data-testid="tasks-list" data-grouping={grouping} className="min-w-0 space-y-3">
      {sections.map((section) => render(section, 0))}
    </div>
  );
}

/** One compact task row: title (and decision line), scope, link icons, created, due, assignees, the status menu. */
function TaskListRow({
  task,
  today,
  showScope,
  onOpen,
  decision,
  onStatus,
}: {
  task: Task;
  today: string;
  showScope: boolean;
  onOpen: (id: string) => void;
  decision: string | undefined;
  onStatus: (s: TaskStatus) => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      data-testid="tasks-list-item"
      className={cn("flex min-w-0 items-center gap-1 pr-2", task.mine ? TASK_MINE : TASK_OTHER)}
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
        className="group flex min-h-10 w-full min-w-0 flex-1 items-center gap-2 py-1 pl-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span
            data-testid="tasks-list-row-title"
            className={cn(
              "relative block min-w-0 truncate text-sm",
              task.mine ? "font-bold" : cn("font-normal", TASK_OTHER_TEXT),
            )}
            title={task.title}
          >
            {task.title}
            {task.mine && <MineText />}
          </span>
          <DecisionLine text={decision} testId="tasks-list-row-decision" />
        </span>
        {showScope && (
          <span
            className="hidden min-w-0 max-w-[12rem] shrink truncate text-xs text-muted-foreground lg:inline"
            data-testid="tasks-list-row-scope"
            data-scope={task.scope}
            title={scopeText(t, task)}
          >
            {scopeText(t, task)}
          </span>
        )}
        <span className="hidden sm:contents">
          <TaskLinkIcons task={task} />
          <LoudPriority task={task} />
          <NoteCount task={task} />
        </span>
        <CreatedText task={task} today={today} />
        <DueText task={task} today={today} />
        {task.assignees.length ? (
          <AssigneeNames people={task.assignees} testId="tasks-list-row-assignees" />
        ) : (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("tasks.unassigned")}
          </span>
        )}
      </button>
      {task.can_set_status && !task.archived_at ? (
        <StatusMenu task={task} onStatus={onStatus} testId="tasks-list-row-status" variant="pill" />
      ) : (
        <TaskStatusBadge
          status={task.status}
          className="shrink-0 rounded-full px-2 py-0 text-[11px]"
        />
      )}
      {task.archived_at && task.can_set_status && (
        <div className="shrink-0">
          <UnarchiveButton task={task} />
        </div>
      )}
    </li>
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
          data-task-id={task.group ? undefined : task.id}
          data-group-id={task.group?.id}
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
          {task.group && <Users className="size-3 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          {task.group && (
            <span className="sr-only">
              {` · ${t("tasks.groups.allMembers", { count: task.group.member_count })}`}
            </span>
          )}
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
