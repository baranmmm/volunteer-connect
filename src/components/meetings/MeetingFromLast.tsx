import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { History, ListChecks } from "lucide-react";
import { TaskStatusBadge } from "@/components/tasks/TaskBadges";
import type { FromLastMeeting } from "@/lib/meetings";
import { meetingDay } from "./meeting-ui";

/**
 * "From last meeting" on an occurrence of a recurring meeting: the previous occurrence's unresolved agenda items and
 * its open tasks, read live (marking an item resolved or a task done there removes it here).
 */
export function MeetingFromLast({ fromLast }: { fromLast: FromLastMeeting }) {
  const { t } = useTranslation();
  const empty = fromLast.items.length === 0 && fromLast.tasks.length === 0;
  return (
    <section
      data-testid="meeting-from-last"
      data-meeting-id={fromLast.meeting_id}
      aria-labelledby="meeting-from-last-title"
      className="min-w-0 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-6"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 id="meeting-from-last-title" className="flex items-center gap-2 text-xl font-semibold">
          <History className="size-5 shrink-0 text-primary" aria-hidden />
          {t("meetings.fromLast.title")}
        </h2>
        <Link
          to="/meetings/$id"
          params={{ id: fromLast.meeting_id }}
          data-testid="meeting-from-last-link"
          className="min-w-0 text-sm text-primary underline-offset-4 hover:underline [overflow-wrap:anywhere]"
        >
          {t("meetings.fromLast.open", { when: meetingDay(fromLast.starts_at) })}
        </Link>
      </div>
      {empty ? (
        <p data-testid="meeting-from-last-empty" className="mt-3 text-muted-foreground">
          {t("meetings.fromLast.empty")}
        </p>
      ) : (
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          {fromLast.items.length > 0 && (
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-muted-foreground">
                {t("meetings.fromLast.items")}
              </h3>
              <ul className="mt-2 grid min-w-0 grid-cols-1 gap-2">
                {fromLast.items.map((item) => (
                  <li
                    key={item.id}
                    data-testid="meeting-from-last-item"
                    data-item-id={item.id}
                    className="min-w-0 rounded-lg border bg-card px-3 py-2"
                  >
                    <span className="block font-medium [overflow-wrap:anywhere]">{item.title}</span>
                    {item.notes && (
                      <span className="mt-0.5 block whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {item.notes}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fromLast.tasks.length > 0 && (
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-muted-foreground">
                {t("meetings.fromLast.tasks")}
              </h3>
              <ul className="mt-2 grid min-w-0 grid-cols-1 gap-2">
                {fromLast.tasks.map((task) => (
                  <li key={task.id} className="min-w-0">
                    <Link
                      to="/tasks"
                      search={{ task: task.id } as never}
                      data-testid="meeting-from-last-task"
                      data-task-id={task.id}
                      data-status={task.status}
                      className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary"
                    >
                      <ListChecks className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium" title={task.title}>
                        {task.title}
                      </span>
                      <TaskStatusBadge status={task.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
