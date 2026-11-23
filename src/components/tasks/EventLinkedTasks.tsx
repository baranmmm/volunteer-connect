import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { getEventTasks } from "@/lib/tasks.functions";
import { TaskStatusBadge } from "./TaskBadges";
import { formatDay } from "./task-display";

/** Tasks linked to an event (only its managers get any); renders nothing when there are none. */
export function EventLinkedTasks({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const fetchTasks = useServerFn(getEventTasks);
  const tasks = useQuery({
    queryKey: ["tasks", "event", eventId],
    queryFn: () => fetchTasks({ data: { eventId } }),
  });
  if (!tasks.data?.length) return null;
  return (
    <section
      data-testid="event-linked-tasks"
      aria-labelledby="event-linked-tasks-title"
      className="min-w-0 space-y-3 border-t pt-5"
    >
      <h2 id="event-linked-tasks-title" className="text-lg font-semibold">
        {t("tasks.eventLinked.title")}
      </h2>
      <ul className="min-w-0 divide-y rounded-xl border">
        {tasks.data.map((task) => (
          <li key={task.id} className="min-w-0">
            <Link
              to="/tasks"
              search={{ task: task.id }}
              data-testid="event-linked-task"
              data-task-id={task.id}
              data-status={task.status}
              className="flex min-h-11 min-w-0 items-center justify-between gap-3 px-3 py-2 hover:bg-muted/60"
            >
              <span className="min-w-0 truncate font-medium" title={task.title}>
                {task.title}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {task.due_date && (
                  <span className="text-xs text-muted-foreground">{formatDay(task.due_date)}</span>
                )}
                <TaskStatusBadge status={task.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
