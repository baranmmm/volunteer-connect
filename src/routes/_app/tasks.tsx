import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, CalendarDays, Columns3, List, Plus } from "lucide-react";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_FILTERS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  filterTasks,
  londonDay,
  readTaskView,
  saveTaskView,
  sortTasks,
  type TaskFilters,
  type TaskGroup,
  type TaskSort,
  type TaskView,
} from "@/lib/tasks";
import { listTasks } from "@/lib/tasks.functions";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import {
  ArchiveDoneButton,
  CalendarView,
  KanbanView,
  ListView,
} from "@/components/tasks/TaskViews";
import { selectClass } from "@/components/tasks/task-display";
import { useWorkScopes } from "@/components/work/use-work-scopes";

const tasksSearch = z.object({ task: z.string().uuid().optional().catch(undefined) });

export const Route = createFileRoute("/_app/tasks")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { task?: string } => {
    const parsed = tasksSearch.parse(search);
    return parsed.task ? { task: parsed.task } : {};
  },
  head: () => pageHead("Tasks", "Plan and follow up Dialogue Society tasks."),
  component: TasksPage,
});

const VIEW_ICONS = { kanban: Columns3, list: List, calendar: CalendarDays } as const;

function TasksPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const navigate = useNavigate();
  const { task: openTask } = Route.useSearch();
  const fetchTasks = useServerFn(listTasks);
  const tasks = useQuery({ queryKey: ["tasks", uid], queryFn: () => fetchTasks(), enabled: !!uid });
  const work = useWorkScopes();
  // Scope labels only for someone who works in more than one place (nothing to tell apart otherwise).
  const showScope = !work.loading && !work.single;
  const [view, setViewState] = useState<TaskView>(() => readTaskView(uid));
  const setView = (v: TaskView) => {
    setViewState(v);
    saveTaskView(uid, v);
  };
  // Every task the user can see by default; "My tasks" starts off (their own tasks are marked instead).
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<TaskSort>("due");
  const [group, setGroup] = useState<TaskGroup>("none");
  const [creating, setCreating] = useState(false);
  const today = londonDay();
  const all = useMemo(() => tasks.data ?? [], [tasks.data]);

  const shown = useMemo(() => {
    const active: TaskFilters =
      view === "list"
        ? filters
        : { ...DEFAULT_FILTERS, mine: filters.mine, archived: !!filters.archived };
    return sortTasks(filterTasks(all, active, today), view === "list" ? sort : "due");
  }, [all, filters, view, sort, today]);

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const x of all)
      for (const a of x.assignees) map.set(a.id, a.full_name ?? t("common.formerMember"));
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, t]);
  const branchOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const x of all) if (x.branch_id) map.set(x.branch_id, x.branch ?? t("common.unnamed"));
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, t]);
  const hasNoBranch = all.some((x) => !x.branch_id);
  // The branch filter only helps when the tasks come from more than one place.
  const showBranchFilter = branchOptions.length + (hasNoBranch ? 1 : 0) > 1;

  const open = (id: string) => void navigate({ to: "/tasks", search: { task: id } });
  const close = () => void navigate({ to: "/tasks", search: {} });
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const filterSelect = (
    key: "status" | "priority" | "assignee" | "branch" | "due",
    label: string,
    options: [string, string][],
  ) => (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={`tasks-filter-${key}`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={`tasks-filter-${key}`}
        data-testid={`tasks-filter-${key}`}
        className={selectClass}
        value={filters[key]}
        onChange={(e) => set(key, e.target.value as never)}
      >
        <option value="all">{t("tasks.filters.all")}</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{t("navigation.tasks")}</h1>
        {work.scopes.length > 0 && (
          <Button data-testid="tasks-new" className="h-11" onClick={() => setCreating(true)}>
            <Plus />
            {t("tasks.new")}
          </Button>
        )}
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div role="group" aria-label={t("tasks.viewLabel")} className="flex flex-wrap gap-1">
          {(["kanban", "list", "calendar"] as const).map((v) => {
            const Icon = VIEW_ICONS[v];
            return (
              <Button
                key={v}
                data-testid={`tasks-view-${v}`}
                variant={view === v ? "secondary" : "ghost"}
                aria-pressed={view === v}
                className="h-11"
                onClick={() => setView(v)}
              >
                <Icon />
                {t(`tasks.views.${v}`)}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="tasks-filter-mine"
            variant={filters.mine ? "default" : "outline"}
            aria-pressed={filters.mine}
            className="h-11 rounded-full"
            onClick={() => set("mine", !filters.mine)}
          >
            {t("dashboard.tasksTitle")}
          </Button>
          <Button
            data-testid="tasks-filter-archived"
            variant={filters.archived ? "default" : "outline"}
            aria-pressed={!!filters.archived}
            className="h-11 rounded-full"
            onClick={() => set("archived", !filters.archived)}
          >
            <Archive />
            {t("tasks.archive.filter")}
          </Button>
        </div>
      </div>
      {view === "list" && (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {filterSelect(
            "status",
            t("tasks.form.status"),
            TASK_STATUSES.map((s) => [s, t(`tasks.status.${s}`)]),
          )}
          {filterSelect(
            "priority",
            t("tasks.form.priority"),
            TASK_PRIORITIES.map((p) => [p, t(`tasks.priority.${p}`)]),
          )}
          {filterSelect("assignee", t("tasks.form.assignees"), assigneeOptions)}
          {showBranchFilter &&
            filterSelect("branch", t("tasks.filters.branch"), [
              ...branchOptions,
              ...(hasNoBranch
                ? ([["none", t("tasks.filters.noBranch")]] as [string, string][])
                : []),
            ])}
          {filterSelect("due", t("tasks.form.dueDate"), [
            ["overdue", t("tasks.filters.dueOverdue")],
            ["week", t("tasks.filters.dueWeek")],
            ["none", t("tasks.filters.dueNone")],
          ])}
          <div className="min-w-0 space-y-1">
            <Label htmlFor="tasks-sort" className="text-xs text-muted-foreground">
              {t("tasks.filters.sort")}
            </Label>
            <select
              id="tasks-sort"
              data-testid="tasks-sort"
              className={selectClass}
              value={sort}
              onChange={(e) => setSort(e.target.value as TaskSort)}
            >
              {(["due", "priority", "title", "status"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`tasks.filters.sortBy.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="tasks-group" className="text-xs text-muted-foreground">
              {t("tasks.filters.group")}
            </Label>
            <select
              id="tasks-group"
              data-testid="tasks-group"
              className={selectClass}
              value={group}
              onChange={(e) => setGroup(e.target.value as TaskGroup)}
            >
              {(["none", "status", "assignee", "mine"] as const).map((g) => (
                <option key={g} value={g}>
                  {t(`tasks.filters.groupBy.${g}`)}
                </option>
              ))}
            </select>
          </div>
          {!filters.archived && group !== "status" && (
            <div className="flex min-w-0 items-end">
              <ArchiveDoneButton tasks={shown} testId="tasks-archive-done" />
            </div>
          )}
        </div>
      )}
      {tasks.isLoading ? (
        <p className="py-10 text-center text-muted-foreground">{t("common.loading")}</p>
      ) : tasks.isError ? (
        <div role="alert" className="space-y-3">
          <p className="text-destructive">{t("tasks.loadError")}</p>
          <Button variant="outline" className="h-11" onClick={() => void tasks.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : shown.length === 0 && view !== "calendar" ? (
        <div
          data-testid="tasks-empty"
          className="space-y-3 border-y py-12 text-center text-muted-foreground"
        >
          <p>
            {all.length === 0
              ? t("tasks.empty")
              : filters.archived
                ? t("tasks.archive.empty")
                : filters.mine
                  ? t("tasks.emptyMine")
                  : t("tasks.emptyFiltered")}
          </p>
          {all.length > 0 && filters.mine && (
            <Button
              variant="outline"
              className="h-11"
              data-testid="tasks-empty-show-all"
              onClick={() => set("mine", false)}
            >
              {t("tasks.showAll")}
            </Button>
          )}
        </div>
      ) : view === "kanban" ? (
        <KanbanView
          tasks={shown}
          today={today}
          onOpen={open}
          markMine={!filters.mine}
          showScope={showScope}
        />
      ) : view === "list" ? (
        <ListView
          tasks={shown}
          today={today}
          onOpen={open}
          group={group}
          markMine={!filters.mine}
          showScope={showScope}
        />
      ) : (
        <CalendarView tasks={shown} today={today} onOpen={open} showScope={showScope} />
      )}
      <TaskPanel taskId={openTask ?? null} onClose={close} />
      <TaskFormDialog open={creating} onClose={() => setCreating(false)} onSaved={open} />
    </div>
  );
}
