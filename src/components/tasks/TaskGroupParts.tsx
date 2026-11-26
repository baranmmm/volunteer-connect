import { useMemo, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ChevronRight, Pencil, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import {
  TASK_PRIORITIES,
  groupCountParts,
  isOverdue,
  londonDay,
  type TaskGroupData,
  type TaskPriority,
} from "@/lib/tasks";
import {
  deleteTaskGroup,
  listTaskPeople,
  setTaskGroupMembers,
  updateTaskGroup,
} from "@/lib/tasks.functions";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EventDialog } from "@/components/events/EventDialog";
import { DateField } from "@/components/events/DateTimeField";
import { PeopleCombobox } from "@/components/work/PeopleCombobox";
import { TaskPriorityBadge, TaskStatusBadge } from "./TaskBadges";
import { formatDay, selectClass } from "./task-display";
import { useTaskGroup } from "./use-task-groups";

/**
 * "All members (6)", a small progress bar (done of all) and the counts per status ("1 Done · 3 In progress · 2 To do").
 */
export function TaskGroupProgress({
  group,
  compact = false,
  className,
}: {
  group: TaskGroupData;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const total = group.member_count;
  const done = group.counts.done;
  const parts = groupCountParts(group.counts);
  const countsText = parts
    .map((p) =>
      t("tasks.groups.countPart", { count: p.count, status: t(`tasks.status.${p.status}`) }),
    )
    .join(" · ");
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span
        className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold"
        data-testid="task-group-members-label"
        data-count={total}
      >
        <Users className="size-3.5" aria-hidden />
        {t("tasks.groups.allMembers", { count: total })}
      </span>
      <span
        role="progressbar"
        aria-label={t("tasks.groups.progress", { done, total })}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        data-testid="task-group-progress"
        data-done={done}
        data-total={total}
        className={cn(
          "relative inline-block h-1.5 shrink-0 overflow-hidden rounded-full bg-muted",
          compact ? "w-12" : "w-20",
        )}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
        />
      </span>
      <span
        className="min-w-0 truncate text-xs text-muted-foreground dark:text-inherit"
        data-testid="task-group-counts"
        title={countsText}
      >
        {countsText}
      </span>
    </span>
  );
}

/** Each member's task and status; a member opens their task (side panel). */
export function TaskGroupMembers({
  group,
  taskLink,
  onRemove,
  busy,
}: {
  group: TaskGroupData;
  /** Where a member's task opens: /tasks?task= or the meeting page with ?task=. */
  taskLink: (taskId: string) => {
    to: string;
    params?: Record<string, string>;
    search: Record<string, string>;
  };
  onRemove?: ((userId: string) => void) | undefined;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul className="min-w-0 divide-y rounded-lg border" data-testid="task-group-members">
      {group.members.map((m) => {
        const link = taskLink(m.task_id);
        return (
          <li
            key={m.task_id}
            className="flex min-w-0 items-center gap-2 px-2"
            data-testid="task-group-member"
            data-task-id={m.task_id}
            data-user-id={m.user_id ?? undefined}
            data-status={m.status}
          >
            <Link
              {...(link as { to: "/tasks"; search: { task: string } })}
              resetScroll={false}
              data-testid="task-group-member-open"
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm hover:underline"
            >
              <span className="min-w-0 flex-1 truncate" title={m.full_name ?? undefined}>
                {m.full_name ?? t("common.formerMember")}
              </span>
              <TaskStatusBadge status={m.status} className="rounded-full" />
            </Link>
            {onRemove && m.user_id && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="shrink-0 text-destructive hover:text-destructive"
                data-testid="task-group-member-remove"
                aria-label={t("tasks.groups.removeMember", {
                  name: m.full_name ?? t("common.formerMember"),
                })}
                disabled={busy || group.member_count <= 1}
                onClick={() => onRemove(m.user_id!)}
              >
                <UserMinus />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A group row with an expand toggle (meeting decisions, event page): title, progress, then each member's task. */
export function TaskGroupLinkedRow({
  groupId,
  testId,
  taskLink,
  editable,
  onEdit,
  onDelete,
}: {
  groupId: string;
  testId: string;
  taskLink: (taskId: string) => {
    to: string;
    params?: Record<string, string>;
    search: Record<string, string>;
  };
  /** Show Edit and Delete when the caller may edit the group. */
  editable?: boolean;
  onEdit?: (g: TaskGroupData) => void;
  onDelete?: (g: TaskGroupData) => void;
}) {
  const { t } = useTranslation();
  const query = useTaskGroup(groupId);
  const [open, setOpen] = useState(false);
  const group = query.data;
  if (!group) return null;
  const bodyId = `${testId}-body-${group.id}`;
  return (
    <li
      className="min-w-0 rounded-lg border bg-card/60 px-2 py-1"
      data-testid={testId}
      data-group-id={group.id}
      data-status={group.status}
    >
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-md text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden
          />
          <span className="min-w-0 flex-[1_1_8rem] truncate font-medium" title={group.title}>
            {group.title}
          </span>
          <TaskGroupProgress group={group} compact />
          <TaskStatusBadge status={group.status} className="rounded-full" />
        </button>
        {editable && group.can_edit && (
          <span className="flex shrink-0 gap-1">
            {onEdit && (
              <Button
                size="icon"
                variant="ghost"
                data-testid={`${testId}-edit`}
                aria-label={t("tasks.groups.edit", { title: group.title })}
                onClick={() => onEdit(group)}
              >
                <Pencil />
              </Button>
            )}
            {onDelete && (
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                data-testid={`${testId}-delete`}
                aria-label={t("tasks.groups.delete", { title: group.title })}
                onClick={() => onDelete(group)}
              >
                <Trash2 />
              </Button>
            )}
          </span>
        )}
      </div>
      <div id={bodyId} hidden={!open} className="pb-1 pl-6">
        {open && <TaskGroupMembers group={group} taskLink={taskLink} />}
      </div>
    </li>
  );
}

/** Edit a group: title, description, priority and due date (written to every member task). */
export function TaskGroupFormDialog({
  group,
  onClose,
}: {
  group: TaskGroupData | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <EventDialog
      open={!!group}
      onClose={onClose}
      title={t("tasks.groups.editTitle")}
      testId="task-group-form"
    >
      {group && <GroupForm key={group.id} group={group} onClose={onClose} />}
    </EventDialog>
  );
}

function GroupForm({ group, onClose }: { group: TaskGroupData; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const save = useServerFn(updateTaskGroup);
  const [title, setTitle] = useState(group.title);
  const [description, setDescription] = useState(group.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(group.priority);
  const [due, setDue] = useState(group.due_date ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError(t("tasks.form.titleRequired"));
    setBusy(true);
    setError("");
    try {
      await save({
        data: {
          id: group.id,
          group: {
            title: title.trim(),
            description: description.trim() ? description : null,
            priority,
            due_date: due || null,
          },
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tasks"] }),
        qc.invalidateQueries({ queryKey: ["meeting"] }),
      ]);
      toast.success(t("tasks.groups.saved"));
      onClose();
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="grid min-w-0 grid-cols-1 gap-4" onSubmit={submit} noValidate>
      <p className="text-sm text-muted-foreground">{t("tasks.groups.editHint")}</p>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="task-group-form-title">{t("tasks.form.title")} *</Label>
        <Input
          id="task-group-form-title"
          data-testid="task-group-form-title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="task-group-form-description">{t("tasks.form.description")}</Label>
        <Textarea
          id="task-group-form-description"
          data-testid="task-group-form-description"
          value={description}
          maxLength={5000}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <DateField
          testId="task-group-form-due-date"
          label={t("tasks.form.dueDate")}
          value={due}
          onChange={setDue}
        />
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="task-group-form-priority">{t("tasks.form.priority")}</Label>
          <select
            id="task-group-form-priority"
            data-testid="task-group-form-priority"
            className={selectClass}
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`tasks.priority.${p}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive" data-testid="task-group-form-error">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          data-testid="task-group-form-cancel"
          disabled={busy}
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" className="h-11" data-testid="task-group-form-submit" disabled={busy}>
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}

/** Delete a group after confirming: every member task goes to the Recycle Bin. */
export function TaskGroupDeleteDialog({
  group,
  onClose,
  onDeleted,
}: {
  group: TaskGroupData | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const remove = useServerFn(deleteTaskGroup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    if (!group) return;
    setBusy(true);
    setError("");
    try {
      const { count } = await remove({ data: { id: group.id } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tasks"] }),
        qc.invalidateQueries({ queryKey: ["meeting"] }),
        qc.invalidateQueries({ queryKey: ["recycle-bin"] }),
      ]);
      toast.success(t("tasks.groups.deleted", { count }));
      onDeleted?.();
      onClose();
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <EventDialog
      open={!!group}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t("tasks.groups.deleteTitle")}
      testId="task-group-delete-dialog"
    >
      <p className="text-muted-foreground [overflow-wrap:anywhere]">
        {t("tasks.groups.deleteText", {
          title: group?.title ?? "",
          count: group?.member_count ?? 0,
        })}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-destructive" data-testid="task-group-delete-error">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          className="h-11"
          data-testid="task-group-delete-cancel"
          disabled={busy}
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          className="h-11"
          data-testid="task-group-delete-confirm"
          disabled={busy}
          onClick={() => void confirm()}
        >
          <Trash2 />
          {busy ? t("tasks.panel.deleting") : t("tasks.groups.deleteConfirm")}
        </Button>
      </div>
    </EventDialog>
  );
}

/** The group side panel on /tasks (?group=<id>): details, progress, members; editors edit, add/remove, delete. */
export function TaskGroupPanel({
  groupId,
  onClose,
}: {
  groupId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={!!groupId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        data-testid="task-group-panel"
        data-group-id={groupId ?? undefined}
        aria-describedby={undefined}
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        {groupId ? (
          <GroupPanelBody key={groupId} groupId={groupId} onClose={onClose} />
        ) : (
          <SheetTitle className="sr-only">{t("tasks.groups.panelTitle")}</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

function GroupPanelBody({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useTaskGroup(groupId);
  const fetchPeople = useServerFn(listTaskPeople);
  const setMembers = useServerFn(setTaskGroupMembers);
  const [editing, setEditing] = useState<TaskGroupData | null>(null);
  const [deleting, setDeleting] = useState<TaskGroupData | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const group = query.data;
  const people = useQuery({
    queryKey: ["tasks", "people", `branch:${group?.branch_id ?? ""}`],
    queryFn: () =>
      fetchPeople({
        data: { scope: "branch", branchId: group!.branch_id, regionId: group!.region_id },
      }),
    enabled: !!group?.can_edit,
  });
  // People who can join: people of the group's branch the caller may assign who are not members yet (a Regional
  // Director's list covers the region, so it is narrowed to the branch; the database checks again).
  const candidates = useMemo(
    () =>
      (people.data ?? []).filter(
        (p) =>
          (!p.branch || !group?.branch || p.branch === group.branch) &&
          !group?.members.some((m) => m.user_id === p.id),
      ),
    [people.data, group],
  );

  async function changeMembers(add: string[], remove: string[]) {
    if (!group) return;
    setBusy(true);
    try {
      const r = await setMembers({ data: { id: group.id, add, remove } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tasks"] }),
        qc.invalidateQueries({ queryKey: ["meeting"] }),
      ]);
      toast.success(
        r.added
          ? t("tasks.groups.membersAdded", { count: r.added })
          : t("tasks.groups.memberRemoved"),
      );
      setAdding([]);
      setRemoving(null);
    } catch (err) {
      toast.error(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading)
    return (
      <div className="p-6">
        <SheetTitle className="sr-only">{t("tasks.groups.panelTitle")}</SheetTitle>
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  if (!group)
    return (
      <div className="space-y-2 p-6" data-testid="task-group-panel-not-found">
        <SheetTitle className="text-lg">{t("tasks.groups.notFoundTitle")}</SheetTitle>
        <p className="text-muted-foreground">{t("tasks.groups.notFoundText")}</p>
      </div>
    );
  const today = londonDay();
  const overdue = isOverdue({ due_date: group.due_date, status: group.status }, today);
  const removingName =
    group.members.find((m) => m.user_id === removing)?.full_name ?? t("common.formerMember");
  return (
    <div
      className="flex min-w-0 flex-col gap-5 p-5 sm:p-6"
      data-testid="task-group-panel-detail"
      data-status={group.status}
    >
      <div className="min-w-0 space-y-2 pr-8">
        <SheetTitle
          className="text-xl [overflow-wrap:anywhere]"
          data-testid="task-group-panel-title"
        >
          {group.title}
        </SheetTitle>
        <div className="flex flex-wrap gap-2">
          <TaskStatusBadge status={group.status} />
          <TaskPriorityBadge priority={group.priority} />
        </div>
        <p className="text-xs text-muted-foreground">{t("tasks.groups.derivedHint")}</p>
      </div>
      {group.description && (
        <p
          className="whitespace-pre-wrap [overflow-wrap:anywhere]"
          data-testid="task-group-panel-description"
        >
          {group.description}
        </p>
      )}
      <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm">
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
          <dt className="text-muted-foreground">{t("tasks.form.dueDate")}</dt>
          <dd
            data-testid="task-group-panel-due"
            className={cn(overdue && "font-semibold text-destructive")}
          >
            {group.due_date ? formatDay(group.due_date) : t("tasks.noDueDate")}
            {overdue && ` · ${t("tasks.overdue")}`}
          </dd>
        </div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
          <dt className="text-muted-foreground">{t("tasks.panel.createdBy")}</dt>
          <dd>{group.created_by_name ?? t("common.formerMember")}</dd>
        </div>
        {group.meeting_id && (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-muted-foreground">{t("tasks.panel.meeting")}</dt>
            <dd>
              <Link
                to="/meetings/$id"
                params={{ id: group.meeting_id }}
                data-testid="task-group-panel-meeting-link"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("tasks.panel.meetingFallback")}
              </Link>
            </dd>
          </div>
        )}
      </dl>
      <section className="min-w-0 space-y-2" aria-labelledby="task-group-panel-members-title">
        <h3 id="task-group-panel-members-title" className="font-semibold">
          {t("tasks.groups.members")}
        </h3>
        <TaskGroupProgress group={group} />
        <TaskGroupMembers
          group={group}
          taskLink={(id) => ({ to: "/tasks", search: { task: id } })}
          busy={busy}
          onRemove={group.can_edit ? (userId) => setRemoving(userId) : undefined}
        />
      </section>
      {group.can_edit && (
        <section className="min-w-0 space-y-2 rounded-xl border p-3" data-testid="task-group-add">
          <PeopleCombobox
            testId="task-group-add-people"
            label={t("tasks.groups.addMembers")}
            people={candidates}
            selected={adding}
            onChange={setAdding}
            disabled={busy}
            loading={people.isLoading}
            emptyText={t("tasks.groups.noneToAdd")}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11"
            data-testid="task-group-add-submit"
            disabled={busy || adding.length === 0}
            onClick={() => void changeMembers(adding, [])}
          >
            <UserPlus />
            {t("tasks.groups.addSubmit", { count: adding.length })}
          </Button>
        </section>
      )}
      {group.can_edit && (
        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
          <Button
            data-testid="task-group-panel-edit"
            variant="outline"
            className="h-11"
            onClick={() => setEditing(group)}
          >
            <Pencil />
            {t("tasks.panel.edit")}
          </Button>
          <Button
            data-testid="task-group-panel-delete"
            variant="outline"
            className="h-11 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleting(group)}
          >
            <Trash2 />
            {t("tasks.groups.deleteConfirm")}
          </Button>
        </div>
      )}
      <TaskGroupFormDialog group={editing} onClose={() => setEditing(null)} />
      <TaskGroupDeleteDialog
        group={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={onClose}
      />
      <EventDialog
        open={!!removing}
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        title={t("tasks.groups.removeTitle")}
        testId="task-group-remove-dialog"
      >
        <p className="text-muted-foreground [overflow-wrap:anywhere]">
          {t("tasks.groups.removeText", { name: removingName })}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="h-11"
            data-testid="task-group-remove-cancel"
            disabled={busy}
            onClick={() => setRemoving(null)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            data-testid="task-group-remove-confirm"
            disabled={busy}
            onClick={() => removing && void changeMembers([], [removing])}
          >
            <UserMinus />
            {t("tasks.groups.removeConfirm")}
          </Button>
        </div>
      </EventDialog>
    </div>
  );
}
