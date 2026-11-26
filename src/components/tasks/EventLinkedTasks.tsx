import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { WORK_SCOPES, linkedRows, visibleEventTasks, type WorkScope } from "@/lib/tasks";
import { getEventTasks } from "@/lib/tasks.functions";
import { listMyWorkScopes, scopeKey } from "@/lib/work-scopes";
import { useWorkMember } from "@/lib/use-work-notices";
import { Button } from "@/components/ui/button";
import { TaskStatusBadge } from "./TaskBadges";
import { TaskFormDialog } from "./TaskFormDialog";
import { TaskGroupLinkedRow } from "./TaskGroupParts";
import { formatDay } from "./task-display";

export type LinkedEvent = {
  id: string;
  title: string;
  /** "branch" | "region" | "national" (the event row's scope). */
  scope: string;
  branch_id: string | null;
  region_id: string | null;
};

/**
 * The tasks linked to an event, for everyone who can see the event (the database returns only the tasks each viewer
 * may see; archived ones are hidden unless there is nothing else), and "Add task" for people who may create tasks in
 * the event's scope (list_my_work_scopes). Renders nothing for followers or when there is nothing to show.
 */
export function EventLinkedTasks({ event }: { event: LinkedEvent }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const member = useWorkMember();
  const fetchTasks = useServerFn(getEventTasks);
  const fetchScopes = useServerFn(listMyWorkScopes);
  const [creating, setCreating] = useState(false);
  const tasks = useQuery({
    queryKey: ["tasks", "event", event.id],
    queryFn: () => fetchTasks({ data: { eventId: event.id } }),
    enabled: member,
  });
  const scopes = useQuery({
    queryKey: ["work-scopes", uid],
    queryFn: () => fetchScopes(),
    enabled: member && !!uid,
  });
  const scope = (WORK_SCOPES as readonly string[]).includes(event.scope)
    ? (event.scope as WorkScope)
    : null;
  const eventScope = scope
    ? { scope, branch_id: event.branch_id, region_id: event.region_id }
    : null;
  const canCreate =
    !!eventScope && (scopes.data ?? []).some((o) => scopeKey(o) === scopeKey(eventScope));
  const shown = visibleEventTasks(tasks.data ?? []);
  if (!member || (!shown.length && !canCreate)) return null;

  return (
    <section
      data-testid="event-linked-tasks"
      aria-labelledby="event-linked-tasks-title"
      className="min-w-0 space-y-3 border-t pt-5"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id="event-linked-tasks-title" className="text-lg font-semibold">
          {t("tasks.eventLinked.title")}
        </h2>
        {canCreate && (
          <Button
            variant="outline"
            className="h-11"
            data-testid="event-add-task"
            onClick={() => setCreating(true)}
          >
            <Plus />
            {t("tasks.eventLinked.add")}
          </Button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="event-linked-tasks-empty">
          {t("tasks.eventLinked.empty")}
        </p>
      ) : (
        <ul className="min-w-0 divide-y rounded-xl border">
          {linkedRows(shown).map((row) => {
            if (row.kind === "group")
              return (
                <TaskGroupLinkedRow
                  key={row.groupId}
                  groupId={row.groupId}
                  testId="event-linked-group"
                  taskLink={(id) => ({ to: "/tasks", search: { task: id } })}
                />
              );
            const task = row.task;
            return (
              <li key={task.id} className="min-w-0">
                <Link
                  to="/tasks"
                  search={{ task: task.id }}
                  data-testid="event-linked-task"
                  data-task-id={task.id}
                  data-status={task.status}
                  data-archived={!!task.archived_at}
                  className="flex min-h-11 min-w-0 items-center justify-between gap-3 px-3 py-2 hover:bg-muted/60"
                >
                  <span className="min-w-0 truncate font-medium" title={task.title}>
                    {task.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {task.due_date && (
                      <span className="text-xs text-muted-foreground">
                        {formatDay(task.due_date)}
                      </span>
                    )}
                    <TaskStatusBadge status={task.status} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {eventScope && (
        <TaskFormDialog
          open={creating}
          onClose={() => setCreating(false)}
          initial={{ ...eventScope, event_id: event.id, event_title: event.title }}
        />
      )}
    </section>
  );
}
