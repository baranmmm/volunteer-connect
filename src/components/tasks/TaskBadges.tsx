import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { TaskPriority, TaskStatus } from "@/lib/tasks";

const STATUS_STYLE: Record<TaskStatus, string> = {
  todo: "border-border bg-muted text-foreground",
  in_progress: "border-primary/30 bg-primary/10 text-primary",
  blocked: "border-destructive/30 bg-destructive/10 text-destructive",
  done: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
};

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  low: "border-border text-muted-foreground",
  medium: "border-border text-foreground",
  high: "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  urgent: "border-destructive/40 bg-destructive/10 text-destructive",
};

const base =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold";

export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="task-status-badge"
      data-status={status}
      className={cn(base, STATUS_STYLE[status], className)}
    >
      {t(`tasks.status.${status}`)}
    </span>
  );
}

export function TaskPriorityBadge({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="task-priority-badge"
      data-priority={priority}
      className={cn(base, PRIORITY_STYLE[priority], className)}
    >
      {t(`tasks.priority.${priority}`)}
    </span>
  );
}
