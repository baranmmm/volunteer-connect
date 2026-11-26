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
  NATIONAL,
  REGION_WIDE,
  TASK_PRIORITIES,
  TASK_STATUSES,
  collapseGroups,
  filterTasks,
  effectiveScopeSelection,
  londonDay,
  readTaskScopeFilter,
  readTaskView,
  saveTaskScopeFilter,
  saveTaskView,
  scopeFilterOptions,
  sortTasks,
  type TaskFilters,
  type TaskSort,
  type TaskView,
} from "@/lib/tasks";
import {
  NO_SOURCES,
  TASK_GROUPINGS,
  groupTaskSections,
  readCollapsed,
  readTaskGrouping,
  saveCollapsed,
  saveTaskGrouping,
  type TaskGrouping,
} from "@/lib/task-grouping";
import { listTasks, listTaskSources } from "@/lib/tasks.functions";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { TaskGroupPanel } from "@/components/tasks/TaskGroupParts";
import { useTaskGroups } from "@/components/tasks/use-task-groups";
import { TaskScopeFilter } from "@/components/tasks/TaskScopeFilter";
import {
  ArchiveDoneButton,
  CalendarView,
  KanbanView,
  ListView,
} from "@/components/tasks/TaskViews";
import { selectClass } from "@/components/tasks/task-display";
import { useWorkScopes } from "@/components/work/use-work-scopes";
import { cn } from "@/lib/utils";

const tasksSearch = z.object({
  task: z.string().uuid().optional().catch(undefined),
  /** An "@all" task group opened in the group panel. */
  group: z.string().uuid().optional().catch(undefined),
  /** A note to highlight in the open task (links from note notices). */
  note: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/tasks")({
  ssr: false,
  validateSearch: (
    search: Record<string, unknown>,
  ): { task?: string; note?: string; group?: string } => {
    const parsed = tasksSearch.parse(search);
    if (!parsed.task) return parsed.group ? { group: parsed.group } : {};
    return parsed.note ? { task: parsed.task, note: parsed.note } : { task: parsed.task };
  },
  head: () => pageHead("Tasks", "Plan and follow up Dialogue Society tasks."),
  component: TasksPage,
});

const VIEW_ICONS = { kanban: Columns3, list: List, calendar: CalendarDays } as const;
// Phones open in the List view (one-line rows); the remembered choice is for larger screens.
const PHONE = "(max-width: 767px)";
const isPhone = () => typeof window !== "undefined" && !!window.matchMedia?.(PHONE).matches;

function TasksPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const navigate = useNavigate();
  const { task: openTask, note: highlightNote, group: openGroup } = Route.useSearch();
  const fetchTasks = useServerFn(listTasks);
  const tasks = useQuery({ queryKey: ["tasks", uid], queryFn: () => fetchTasks(), enabled: !!uid });
  // "@all" groups: one row per group for everyone who is not a member; members see only their own task.
  const groups = useTaskGroups(uid);
  const work = useWorkScopes();
  // Scope labels only for someone who works in more than one place (nothing to tell apart otherwise).
  const showScope = !work.loading && !work.single;
  const [view, setViewState] = useState<TaskView>(() => (isPhone() ? "list" : readTaskView(uid)));
  const setView = (v: TaskView) => {
    setViewState(v);
    if (!isPhone()) saveTaskView(uid, v);
  };
  // Group by (List and Board) and the sections the user collapsed or opened, remembered per user.
  const [grouping, setGroupingState] = useState<TaskGrouping>(() => readTaskGrouping(uid));
  const setGrouping = (g: TaskGrouping) => {
    setGroupingState(g);
    saveTaskGrouping(uid, g);
  };
  const [remembered, setRemembered] = useState<Record<string, boolean>>(() => readCollapsed(uid));
  const toggleSection = (key: string, collapsed: boolean) =>
    setRemembered((cur) => {
      const { [key]: _drop, ...rest } = cur;
      const next = { ...rest, [key]: collapsed };
      saveCollapsed(uid, next);
      return next;
    });
  const fetchSources = useServerFn(listTaskSources);
  const sources = useQuery({
    queryKey: ["task-sources", uid],
    queryFn: () => fetchSources(),
    enabled: !!uid && grouping === "source",
    staleTime: 60_000,
  });
  // Every task the user can see by default; "My tasks" starts off (their own tasks are marked instead).
  // The branch/region choice is remembered per user (applies to every view).
  const [filters, setFilters] = useState<TaskFilters>(() => ({
    ...DEFAULT_FILTERS,
    ...readTaskScopeFilter(uid),
  }));
  const [sort, setSort] = useState<TaskSort>("due");
  const [creating, setCreating] = useState(false);
  const today = londonDay();
  const all = useMemo(
    () => collapseGroups(tasks.data ?? [], groups.data ?? []),
    [tasks.data, groups.data],
  );

  // Branch/region filters only for someone who works in more than one place (RD, NC). Options come from the visible
  // tasks and the work scopes; branch options narrow to the chosen regions, and a remembered value that is no longer
  // offered stops filtering.
  const scopeFilters = showScope;
  const regionOptionsRaw = useMemo(
    () => scopeFilterOptions(all, work.scopes, [], t("common.unnamed")).regions,
    [all, work.scopes, t],
  );
  const regions = scopeFilters ? effectiveScopeSelection(filters.regions, regionOptionsRaw) : [];
  const regionsKey = regions.join(",");
  const branchOptionsRaw = useMemo(
    () =>
      scopeFilterOptions(
        all,
        work.scopes,
        regionsKey ? regionsKey.split(",") : [],
        t("common.unnamed"),
      ).branches,
    [all, work.scopes, regionsKey, t],
  );
  const branches = scopeFilters ? effectiveScopeSelection(filters.branches, branchOptionsRaw) : [];
  const branchesKey = branches.join(",");
  const showRegionFilter =
    scopeFilters &&
    (work.scopes.some((s) => s.scope === "national") || regionOptionsRaw.length > 1);
  const showBranchFilter = scopeFilters && branchOptionsRaw.length > 0;
  const regionOptions: [string, string][] = regionOptionsRaw.map(([v, text]) => [
    v,
    v === NATIONAL ? t("tasks.filters.national") : (text ?? ""),
  ]);
  const branchOptions: [string, string][] = branchOptionsRaw.map(([v, text]) => [
    v,
    v === REGION_WIDE ? t("tasks.filters.regionWide") : (text ?? ""),
  ]);

  const shown = useMemo(() => {
    const scope = {
      branches: branchesKey ? branchesKey.split(",") : [],
      regions: regionsKey ? regionsKey.split(",") : [],
    };
    const active: TaskFilters =
      view === "list"
        ? { ...filters, ...scope }
        : { ...DEFAULT_FILTERS, ...scope, mine: filters.mine, archived: !!filters.archived };
    return sortTasks(filterTasks(all, active, today), view === "list" ? sort : "due");
  }, [all, filters, view, sort, today, branchesKey, regionsKey]);

  const sections = useMemo(
    () =>
      groupTaskSections(shown, grouping, sources.data ?? NO_SOURCES, today, {
        other: t("tasks.grouping.other"),
        unassigned: t("tasks.unassigned"),
        allMembers: t("tasks.grouping.allMembers"),
        formerMember: t("common.formerMember"),
      }),
    [shown, grouping, sources.data, today, t],
  );

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const x of all)
      for (const a of x.assignees) map.set(a.id, a.full_name ?? t("common.formerMember"));
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, t]);

  const groupIds = useMemo(() => new Set((groups.data ?? []).map((g) => g.id)), [groups.data]);
  const open = (id: string) =>
    void navigate({ to: "/tasks", search: groupIds.has(id) ? { group: id } : { task: id } });
  const close = () => void navigate({ to: "/tasks", search: {} });
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const setScope = (key: "branches" | "regions", values: string[]) =>
    setFilters((f) => {
      const next = { ...f, [key]: values };
      saveTaskScopeFilter(uid, { branches: next.branches, regions: next.regions });
      return next;
    });

  const filterSelect = (
    key: "status" | "priority" | "assignee" | "due",
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
        <div className="flex flex-wrap items-center gap-2">
          {view !== "calendar" && (
            <div className="flex items-center gap-2">
              <Label htmlFor="tasks-group-by" className="text-sm text-muted-foreground">
                {t("tasks.grouping.label")}
              </Label>
              <select
                id="tasks-group-by"
                data-testid="tasks-group-by"
                className={cn(selectClass, "h-11 w-auto")}
                value={grouping}
                onChange={(e) => setGrouping(e.target.value as TaskGrouping)}
              >
                {TASK_GROUPINGS.map((g) => (
                  <option key={g} value={g}>
                    {t(`tasks.grouping.by.${g}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
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
      {(showRegionFilter || showBranchFilter) && (
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          {showRegionFilter && (
            <TaskScopeFilter
              testId="tasks-filter-regions"
              label={t("tasks.filters.regions")}
              options={regionOptions}
              selected={regions}
              onChange={(v) => setScope("regions", v)}
              disabled={filters.mine}
              describedBy={filters.mine ? "tasks-filter-scope-hint" : undefined}
            />
          )}
          {showBranchFilter && (
            <TaskScopeFilter
              testId="tasks-filter-branches"
              label={t("tasks.filters.branches")}
              options={branchOptions}
              selected={branches}
              onChange={(v) => setScope("branches", v)}
              disabled={filters.mine}
              describedBy={filters.mine ? "tasks-filter-scope-hint" : undefined}
            />
          )}
          {filters.mine && (
            <p
              id="tasks-filter-scope-hint"
              data-testid="tasks-filter-scope-hint"
              className="min-w-0 pb-3 text-sm text-muted-foreground"
            >
              {t("tasks.filters.scopeHint")}
            </p>
          )}
        </div>
      )}
      {view === "list" && (
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
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
          {!filters.archived && (
            <div className="col-span-2 flex min-w-0 items-end lg:col-span-1">
              <ArchiveDoneButton tasks={shown} testId="tasks-archive-done" />
            </div>
          )}
        </div>
      )}
      {tasks.isLoading || groups.isLoading ? (
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
          showScope={showScope}
          sections={sections}
          remembered={remembered}
          onToggle={toggleSection}
          grouping={grouping}
          autoCollapse={!filters.archived}
        />
      ) : view === "list" ? (
        <ListView
          tasks={shown}
          today={today}
          onOpen={open}
          showScope={showScope}
          sections={sections}
          remembered={remembered}
          onToggle={toggleSection}
          grouping={grouping}
          autoCollapse={!filters.archived}
        />
      ) : (
        <CalendarView tasks={shown} today={today} onOpen={open} showScope={showScope} />
      )}
      <TaskPanel taskId={openTask ?? null} highlightNote={highlightNote} onClose={close} />
      <TaskGroupPanel groupId={openTask ? null : (openGroup ?? null)} onClose={close} />
      <TaskFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={open}
        onSavedGroup={(id) => void navigate({ to: "/tasks", search: { group: id } })}
      />
    </div>
  );
}
