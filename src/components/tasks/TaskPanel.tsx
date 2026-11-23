import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { TASK_STATUSES, isOverdue, londonDay, type TaskDetail, type TaskStatus } from "@/lib/tasks";
import { deleteTask, getTask, setTaskReminderMute } from "@/lib/tasks.functions";
import { useMarkNoticesRead } from "@/lib/use-work-notices";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EventDialog } from "@/components/events/EventDialog";
import { TaskPriorityBadge, TaskStatusBadge } from "./TaskBadges";
import { TaskFormDialog } from "./TaskFormDialog";
import { useSetTaskStatus } from "./use-task-status";
import { formatDay, scopeText, selectClass } from "./task-display";

/** The task detail side panel (full width on phones). `taskId` null closes it. */
export function TaskPanel({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={!!taskId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        data-testid="task-panel"
        data-task-id={taskId ?? undefined}
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        {taskId ? (
          <PanelBody key={taskId} taskId={taskId} onClose={onClose} />
        ) : (
          <SheetTitle className="sr-only">{t("tasks.panel.title")}</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const fetchTask = useServerFn(getTask);
  const query = useQuery({
    queryKey: ["tasks", "detail", taskId],
    queryFn: () => fetchTask({ data: { id: taskId } }),
  });
  // Opening the item marks its notices as read (assignments, status changes and reminders are all "task" notices).
  useMarkNoticesRead([{ entityType: "task", entityId: taskId }], "total");

  if (query.isLoading)
    return (
      <div className="p-6">
        <SheetTitle className="sr-only">{t("tasks.panel.title")}</SheetTitle>
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="space-y-3 p-6">
        <SheetTitle className="sr-only">{t("tasks.panel.title")}</SheetTitle>
        <p className="text-destructive">{t("tasks.loadError")}</p>
        <Button variant="outline" className="h-11" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  if (!query.data)
    return (
      <div className="space-y-2 p-6" data-testid="task-panel-not-found">
        <SheetTitle className="text-lg">{t("tasks.panel.notFoundTitle")}</SheetTitle>
        <p className="text-muted-foreground">{t("tasks.panel.notFoundText")}</p>
      </div>
    );
  return <PanelDetail task={query.data} onClose={onClose} />;
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"
      data-testid={testId}
    >
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function PanelDetail({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const setStatus = useSetTaskStatus();
  const mute = useServerFn(setTaskReminderMute);
  const remove = useServerFn(deleteTask);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = londonDay();
  const overdue = isOverdue(task, today);
  const assigned = task.assignees.some((a) => a.id === session?.user.id);

  async function toggleMute(muted: boolean) {
    try {
      await mute({ data: { id: task.id, muted } });
      queryClient.setQueryData(["tasks", "detail", task.id], {
        ...task,
        my_reminders_muted: muted,
      });
      toast.success(muted ? t("tasks.panel.muted") : t("tasks.panel.unmuted"));
    } catch (e) {
      toast.error(translateError(e));
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setError("");
    try {
      await remove({ data: { id: task.id } });
      toast.success(t("tasks.panel.deleted"));
      setDeleting(false);
      onClose();
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  const r = task.reminders;
  const reminderLines = [
    r.before_days.length
      ? t("tasks.reminders.before", { days: r.before_days.join(", ") })
      : t("tasks.reminders.noBefore"),
    r.repeat_kind === "none"
      ? null
      : r.repeat_kind === "every_n"
        ? t("tasks.reminders.everyN", { count: r.repeat_every_days ?? 0 })
        : t(`tasks.reminders.${r.repeat_kind}`),
    r.repeat_kind !== "none" && r.repeat_start
      ? t("tasks.reminders.startingOn", { date: formatDay(r.repeat_start) })
      : null,
    r.overdue_every_days ? t("tasks.reminders.overdue", { count: r.overdue_every_days }) : null,
  ].filter((x): x is string => !!x);

  return (
    <div
      className="flex min-w-0 flex-col gap-5 p-5 sm:p-6"
      data-testid="task-panel-detail"
      data-status={task.status}
    >
      <div className="min-w-0 space-y-2 pr-8">
        <SheetTitle className="text-xl [overflow-wrap:anywhere]" data-testid="task-panel-title">
          {task.title}
        </SheetTitle>
        <div className="flex flex-wrap gap-2">
          <TaskStatusBadge status={task.status} />
          <TaskPriorityBadge priority={task.priority} />
        </div>
      </div>
      {task.description && (
        <p
          className="whitespace-pre-wrap [overflow-wrap:anywhere]"
          data-testid="task-panel-description"
        >
          {task.description}
        </p>
      )}
      <dl className="grid min-w-0 grid-cols-1 gap-3">
        <Row label={t("tasks.form.status")}>
          {task.can_set_status ? (
            <select
              data-testid="task-panel-status"
              aria-label={t("tasks.form.status")}
              className={selectClass}
              value={task.status}
              onChange={(e) => void setStatus(task.id, e.target.value as TaskStatus)}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`tasks.status.${s}`)}
                </option>
              ))}
            </select>
          ) : (
            <TaskStatusBadge status={task.status} />
          )}
        </Row>
        <Row label={t("tasks.form.priority")}>
          <TaskPriorityBadge priority={task.priority} />
        </Row>
        <Row label={t("tasks.form.dueDate")} testId="task-panel-due">
          {task.due_date ? (
            <span
              data-overdue={overdue}
              className={cn(overdue && "font-semibold text-destructive")}
            >
              {formatDay(task.due_date)}
              {overdue && ` · ${t("tasks.overdue")}`}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("tasks.noDueDate")}</span>
          )}
        </Row>
        <Row label={t("work.scope.label")} testId="task-panel-scope">
          {scopeText(t, task)}
        </Row>
        <Row label={t("tasks.panel.createdBy")} testId="task-panel-creator">
          {task.created_by_name ?? t("common.formerMember")}
        </Row>
        <Row label={t("tasks.form.assignees")} testId="task-panel-assignees">
          {task.assignees.length ? (
            <ul className="space-y-1">
              {task.assignees.map((a) => (
                <li key={a.id} data-user-id={a.id}>
                  {a.full_name ?? t("common.formerMember")}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">{t("tasks.unassigned")}</span>
          )}
        </Row>
        {task.event_id && (
          <Row label={t("tasks.form.event")}>
            <Link
              to="/events/$id"
              params={{ id: task.event_id }}
              data-testid="task-panel-event-link"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {task.event_title ?? t("tasks.form.unknownEvent")}
            </Link>
          </Row>
        )}
        {task.meeting_id && (
          <Row label={t("tasks.panel.meeting")}>
            <Link
              to="/meetings/$id"
              params={{ id: task.meeting_id }}
              data-testid="task-panel-meeting-link"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {task.meeting_title ?? t("tasks.panel.meetingFallback")}
            </Link>
            {task.decision_text && (
              <p className="mt-1 text-sm text-muted-foreground" data-testid="task-panel-decision">
                {t("tasks.panel.decision", { text: task.decision_text })}
              </p>
            )}
          </Row>
        )}
        {task.due_date && (
          <Row label={t("tasks.form.reminders")} testId="task-panel-reminders">
            <ul className="space-y-1 text-sm">
              {reminderLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Row>
        )}
      </dl>
      {assigned && (
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border p-3">
          <label htmlFor="task-panel-mute-reminders" className="text-sm font-medium">
            {t("tasks.panel.muteReminders")}
          </label>
          <Switch
            id="task-panel-mute-reminders"
            data-testid="task-panel-mute-reminders"
            checked={!!task.my_reminders_muted}
            onCheckedChange={(v) => void toggleMute(v)}
          />
        </div>
      )}
      {task.can_edit && (
        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
          <Button
            data-testid="task-panel-edit"
            variant="outline"
            className="h-11"
            onClick={() => setEditing(true)}
          >
            <Pencil />
            {t("tasks.panel.edit")}
          </Button>
          <Button
            data-testid="task-panel-delete"
            variant="outline"
            className="h-11 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setError("");
              setDeleting(true);
            }}
          >
            <Trash2 />
            {t("tasks.panel.delete")}
          </Button>
        </div>
      )}
      <TaskFormDialog open={editing} onClose={() => setEditing(false)} task={task} />
      <EventDialog
        open={deleting}
        onClose={() => {
          if (!busy) setDeleting(false);
        }}
        title={t("tasks.panel.deleteTitle")}
        testId="task-delete-dialog"
      >
        <p className="text-muted-foreground">{t("tasks.panel.deleteText")}</p>
        {error && (
          <p role="alert" className="mt-3 text-destructive" data-testid="task-delete-error">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="h-11"
            data-testid="task-delete-cancel"
            disabled={busy}
            onClick={() => setDeleting(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="task-delete-confirm"
            variant="destructive"
            className="h-11"
            disabled={busy}
            onClick={() => void confirmDelete()}
          >
            <Trash2 />
            {busy ? t("tasks.panel.deleting") : t("tasks.panel.delete")}
          </Button>
        </div>
      </EventDialog>
    </div>
  );
}
