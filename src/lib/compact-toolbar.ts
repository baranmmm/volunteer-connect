// The phone toolbars (< 640px) keep their settings in a "Filters" bottom sheet; its button shows how many settings
// differ from the page's defaults. Pure helpers so the count is tested without the UI (src/test/compact-toolbar.test.ts).
import type { TaskFilters, TaskView } from "@/lib/tasks";
import type { TaskGrouping, TaskRowSort } from "@/lib/task-grouping";

/** A setting's current value and its default (arrays compare by their items, in any order). */
export type SettingPair = readonly [current: unknown, initial: unknown];

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v) => b.includes(v));
  return a === b;
}

/** How many settings differ from their defaults. */
export function countChanged(settings: readonly SettingPair[]): number {
  return settings.filter(([current, initial]) => !same(current, initial)).length;
}

/** /tasks defaults (the same as readTaskGrouping / readTaskRowSort / DEFAULT_FILTERS without a remembered choice). */
export const DEFAULT_TASK_GROUPING: TaskGrouping = "meeting";
export const DEFAULT_TASK_ROW_SORT: TaskRowSort = "status";

/**
 * Non-default /tasks settings that apply to the current view: Group by and Sort (List and Board), My tasks and
 * Archived (every view), the status/priority/assignee/due filters (List only) and the effective branch/region
 * choice (only where those filters are offered: pass the effective selections, empty otherwise).
 */
export function taskToolbarChanges(s: {
  view: TaskView;
  grouping: TaskGrouping;
  sort: TaskRowSort;
  filters: Pick<TaskFilters, "mine" | "archived" | "status" | "priority" | "assignee" | "due">;
  regions: readonly string[];
  branches: readonly string[];
}): number {
  const pairs: SettingPair[] = [
    [s.filters.mine, false],
    [!!s.filters.archived, false],
    [s.regions, []],
    [s.branches, []],
  ];
  if (s.view !== "calendar")
    pairs.push([s.grouping, DEFAULT_TASK_GROUPING], [s.sort, DEFAULT_TASK_ROW_SORT]);
  if (s.view === "list")
    pairs.push(
      [s.filters.status, "all"],
      [s.filters.priority, "all"],
      [s.filters.assignee, "all"],
      [s.filters.due, "all"],
    );
  return countChanged(pairs);
}

/**
 * Non-default /calendar settings: Upcoming/Past (List only), Public events only (managers only: pass
 * `publicOnly: null` otherwise), the branch scope against its default and the category and organizer filters.
 */
export function calendarToolbarChanges(s: {
  view: "month" | "list";
  past: boolean;
  publicOnly: boolean | null;
  branchScope: "followed" | "all";
  defaultBranchScope: "followed" | "all";
  category: string;
  organizer: string;
}): number {
  const pairs: SettingPair[] = [
    [s.branchScope, s.defaultBranchScope],
    [s.category, "all"],
    [s.organizer, "all"],
  ];
  if (s.view === "list") pairs.push([s.past, false]);
  if (s.publicOnly !== null) pairs.push([s.publicOnly, false]);
  return countChanged(pairs);
}
