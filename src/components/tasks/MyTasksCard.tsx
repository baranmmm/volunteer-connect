import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ListChecks } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isDueSoon, isOverdue } from "@/lib/tasks";
import { getMyTaskSummary } from "@/lib/tasks.functions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TaskPriorityBadge, TaskStatusBadge } from "./TaskBadges";
import { formatDay } from "./task-display";

/** Dashboard card: open and overdue counts of the caller's tasks and the next five by due date. */
export function MyTasksCard() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const fetchSummary = useServerFn(getMyTaskSummary);
  const summary = useQuery({
    queryKey: ["tasks", "summary", uid],
    queryFn: () => fetchSummary(),
    enabled: !!uid,
  });
  const data = summary.data;
  return (
    <section
      data-testid="dashboard-my-tasks"
      data-open={data?.open}
      data-overdue={data?.overdue}
      aria-labelledby="dashboard-my-tasks-title"
      className="min-w-0 rounded-2xl border bg-card p-6 shadow-soft"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-secondary p-2.5 text-primary">
            <ListChecks className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="dashboard-my-tasks-title" className="text-xl font-semibold">
            {t("dashboard.tasksTitle")}
          </h2>
        </div>
        <Link
          data-testid="dashboard-my-tasks-link"
          to="/tasks"
          className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("tasks.card.viewAll")}
        </Link>
      </div>
      {summary.isLoading ? (
        <p className="mt-6 text-muted-foreground">{t("common.loading")}</p>
      ) : summary.isError || !data ? (
        <div role="alert" className="mt-6 space-y-3">
          <p className="text-destructive">{t("tasks.loadError")}</p>
          <Button variant="outline" className="h-11" onClick={() => void summary.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            <p
              className="rounded-xl bg-muted px-3 py-2 text-sm"
              data-testid="dashboard-my-tasks-open"
            >
              <span className="text-lg font-semibold">{data.open}</span>{" "}
              {t("tasks.card.open", { count: data.open })}
            </p>
            <p
              className={cn(
                "rounded-xl px-3 py-2 text-sm",
                data.overdue > 0 ? "bg-destructive/10 text-destructive" : "bg-muted",
              )}
              data-testid="dashboard-my-tasks-overdue"
            >
              <span className="text-lg font-semibold">{data.overdue}</span>{" "}
              {t("tasks.card.overdue", { count: data.overdue })}
            </p>
          </div>
          {data.next.length === 0 ? (
            <p className="mt-5 text-muted-foreground" data-testid="dashboard-my-tasks-empty">
              {t("tasks.card.empty")}
            </p>
          ) : (
            <ul className="mt-5 min-w-0 space-y-2">
              {data.next.slice(0, 5).map((task) => {
                const overdue = isOverdue(task, data.today),
                  soon = isDueSoon(task, data.today);
                return (
                  <li key={task.id} className="min-w-0">
                    <Link
                      to="/tasks"
                      search={{ task: task.id }}
                      data-testid="dashboard-my-task-item"
                      data-task-id={task.id}
                      data-due-soon={soon}
                      data-overdue={overdue}
                      className="flex min-h-11 min-w-0 flex-col gap-1 rounded-xl border p-3 hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <span className="min-w-0 truncate font-medium" title={task.title}>
                        {task.title}
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center gap-2">
                        <TaskStatusBadge status={task.status} />
                        <TaskPriorityBadge priority={task.priority} />
                        {task.due_date && (
                          <span
                            className={cn(
                              "whitespace-nowrap text-xs",
                              overdue
                                ? "font-semibold text-destructive"
                                : soon
                                  ? "font-semibold text-amber-700 dark:text-amber-300"
                                  : "text-muted-foreground",
                            )}
                          >
                            {formatDay(task.due_date)}
                            {overdue
                              ? ` · ${t("tasks.overdue")}`
                              : soon
                                ? ` · ${t("tasks.dueSoon")}`
                                : ""}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
