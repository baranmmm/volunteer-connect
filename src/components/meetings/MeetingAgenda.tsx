import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ListChecks,
  Pencil,
  MoreHorizontal,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { EventDialog } from "@/components/events/EventDialog";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskStatusBadge } from "@/components/tasks/TaskBadges";
import { AssigneeNames } from "@/components/tasks/AssigneeNames";
import { deleteTask, getTask } from "@/lib/tasks.functions";
import { linkedRows, type TaskDetail, type TaskGroupData } from "@/lib/tasks";
import {
  TaskGroupDeleteDialog,
  TaskGroupFormDialog,
  TaskGroupLinkedRow,
} from "@/components/tasks/TaskGroupParts";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNarrowScreen } from "@/hooks/use-narrow-screen";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitOnEnter } from "@/lib/enter-submit";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { AgendaItem, MeetingDetail } from "@/lib/meetings";
import {
  addAgendaItem,
  addMeetingDecision,
  deleteAgendaItem,
  deleteMeetingDecision,
  moveAgendaItem,
  setAgendaItemResolved,
  updateAgendaItem,
  updateMeetingDecision,
} from "@/lib/meetings.functions";
import { agendaCounts } from "./meeting-ui";

type Decision = AgendaItem["decisions"][number];

/**
 * Agenda items with their decisions and the tasks created from them. Invitees see everything read-only.
 * Each item is a toggle row (chevron, title, "2 decisions, 3 tasks"), collapsed by default; expanding it shows the
 * notes, decisions, tasks and the editing controls. A just-added item opens expanded. "Expand all / Collapse all"
 * (meeting-agenda-expand-all, aria-pressed) opens or closes every item.
 */
export function MeetingAgenda({ meeting }: { meeting: MeetingDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const editable = meeting.can_edit;
  const add = useServerFn(addAgendaItem),
    update = useServerFn(updateAgendaItem),
    remove = useServerFn(deleteAgendaItem),
    move = useServerFn(moveAgendaItem),
    setResolved = useServerFn(setAgendaItemResolved),
    addDecision = useServerFn(addMeetingDecision),
    updateDecision = useServerFn(updateMeetingDecision),
    removeDecision = useServerFn(deleteMeetingDecision);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [decisionFor, setDecisionFor] = useState<string | null>(null);
  const [editingDecision, setEditingDecision] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AgendaItem | null>(null);
  const [taskFor, setTaskFor] = useState<Decision | null>(null);
  // A task under a decision: edit (the task form) or delete (to the Recycle Bin, after confirming).
  const [editingTask, setEditingTask] = useState<TaskDetail | null>(null);
  const [removingTask, setRemovingTask] = useState<DecisionTask | null>(null);
  const removeTask = useServerFn(deleteTask);
  // An "@all" group under a decision: edit (to every member task) or delete (every member task to the Recycle Bin).
  const [editingGroup, setEditingGroup] = useState<TaskGroupData | null>(null);
  const [removingGroup, setRemovingGroup] = useState<TaskGroupData | null>(null);
  // Expanded agenda items (collapsed by default).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const setOpen = (id: string, open: boolean) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const countsText = (c: { decisions: number; tasks: number }) => {
    const decisions = c.decisions
      ? t("meetings.agenda.decisionsCount", { count: c.decisions })
      : "";
    const tasks = c.tasks ? t("meetings.agenda.tasksCount", { count: c.tasks }) : "";
    return decisions && tasks
      ? t("meetings.agenda.countsBoth", { decisions, tasks })
      : decisions || tasks;
  };
  // Resolved checkboxes answer at once; the saved value replaces this once the meeting is read again.
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  async function toggleResolved(id: string, resolved: boolean) {
    setResolving((r) => ({ ...r, [id]: resolved }));
    await run(
      () => setResolved({ data: { id, resolved } }),
      resolved ? t("meetings.agenda.markedResolved") : t("meetings.agenda.markedOpen"),
    );
    setResolving(({ [id]: _, ...rest }) => rest);
  }

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["meeting", meeting.id] }),
        qc.invalidateQueries({ queryKey: ["meeting-series-tasks"] }),
      ]);
      if (success) toast.success(success);
      return true;
    } catch (e) {
      toast.error(translateError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const items = [...meeting.agenda].sort((a, b) => a.position - b.position);
  const allOpen = items.length > 0 && items.every((item) => expanded.has(item.id));
  return (
    <section
      data-testid="meeting-agenda"
      aria-labelledby="meeting-agenda-title"
      className="min-w-0 rounded-2xl border bg-card p-4 shadow-soft sm:p-6"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id="meeting-agenda-title" className="text-xl font-semibold">
          {t("meetings.agenda.title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {items.length > 0 && (
            <Button
              type="button"
              data-testid="meeting-agenda-expand-all"
              aria-pressed={allOpen}
              variant="ghost"
              className="h-11"
              onClick={() =>
                setExpanded(allOpen ? new Set() : new Set(items.map((item) => item.id)))
              }
            >
              {allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
              {allOpen ? t("meetings.agenda.collapseAll") : t("meetings.agenda.expandAll")}
            </Button>
          )}
          {editable && !adding && (
            <Button
              data-testid="meeting-agenda-add"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => {
                setEditingItem(null);
                setAdding(true);
              }}
            >
              <Plus />
              {t("meetings.agenda.add")}
            </Button>
          )}
        </div>
      </div>
      {editable && adding && (
        <ItemForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSave={async (title, notes) => {
            // A new item opens expanded, ready for its decisions.
            if (
              await run(async () => {
                const id = await add({ data: { meetingId: meeting.id, title, notes } });
                setOpen(id, true);
              }, t("meetings.agenda.added"))
            )
              setAdding(false);
          }}
        />
      )}
      {items.length === 0 ? (
        <p data-testid="meeting-agenda-empty" className="mt-4 text-muted-foreground">
          {t("meetings.agenda.empty")}
        </p>
      ) : (
        <ol className="mt-4 grid min-w-0 grid-cols-1 gap-3">
          {items.map((item, index) => {
            const open = expanded.has(item.id);
            const counts = agendaCounts(item);
            const bodyId = `meeting-agenda-item-body-${item.id}`;
            return (
              <li
                key={item.id}
                data-testid="meeting-agenda-item"
                data-item-id={item.id}
                data-resolved={resolving[item.id] ?? item.resolved}
                data-standing={item.standing}
                data-expanded={open}
                className="min-w-0 rounded-xl border p-2 sm:p-3"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="min-w-0 flex-1">
                    <button
                      type="button"
                      data-testid="meeting-agenda-item-toggle"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => setOpen(item.id, !open)}
                      className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-1 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          open && "rotate-90",
                        )}
                        aria-hidden
                      />
                      <span className="shrink-0 font-semibold text-muted-foreground" aria-hidden>
                        {index + 1}.
                      </span>
                      <span
                        data-testid="meeting-agenda-item-title"
                        className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]"
                      >
                        {item.title}
                      </span>
                      <span
                        data-testid="meeting-agenda-item-counts"
                        data-decisions={counts.decisions}
                        data-tasks={counts.tasks}
                        className="shrink-0 text-xs font-normal text-muted-foreground"
                      >
                        {countsText(counts)}
                      </span>
                    </button>
                  </h3>
                  {(item.standing || (item.resolved && !editable)) && (
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {item.standing && (
                        <Badge
                          variant="secondary"
                          data-testid="meeting-agenda-standing"
                          className="gap-1"
                        >
                          <Repeat className="size-3" aria-hidden />
                          {t("meetings.agenda.standing")}
                        </Badge>
                      )}
                      {item.resolved && !editable && (
                        <Badge variant="outline" data-testid="meeting-agenda-resolved-badge">
                          {t("meetings.agenda.resolved")}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <div
                  id={bodyId}
                  data-testid="meeting-agenda-item-body"
                  hidden={!open}
                  className="min-w-0 px-1 pb-1"
                >
                  {open && (
                    <>
                      {editingItem === item.id ? (
                        <ItemForm
                          busy={busy}
                          title={item.title}
                          notes={item.notes ?? ""}
                          onCancel={() => setEditingItem(null)}
                          onSave={async (title, notes) => {
                            if (
                              await run(
                                () => update({ data: { id: item.id, title, notes } }),
                                t("meetings.agenda.updated"),
                              )
                            )
                              setEditingItem(null);
                          }}
                        />
                      ) : (
                        (editable || item.notes) && (
                          <div className="mt-1 flex min-w-0 flex-wrap items-start gap-3">
                            <div className="min-w-0 flex-1">
                              {editable && (
                                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                                  <Checkbox
                                    data-testid="meeting-agenda-resolved"
                                    checked={resolving[item.id] ?? item.resolved}
                                    disabled={busy}
                                    onCheckedChange={(checked) =>
                                      void toggleResolved(item.id, checked === true)
                                    }
                                  />
                                  {t("meetings.agenda.resolved")}
                                </label>
                              )}
                              {item.notes && (
                                <p
                                  data-testid="meeting-agenda-item-notes"
                                  className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]"
                                >
                                  {item.notes}
                                </p>
                              )}
                            </div>
                            {editable && (
                              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid="meeting-agenda-up"
                                  aria-label={t("meetings.agenda.moveUp")}
                                  disabled={busy || index === 0}
                                  onClick={() =>
                                    void run(() => move({ data: { id: item.id, direction: -1 } }))
                                  }
                                >
                                  <ArrowUp />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid="meeting-agenda-down"
                                  aria-label={t("meetings.agenda.moveDown")}
                                  disabled={busy || index === items.length - 1}
                                  onClick={() =>
                                    void run(() => move({ data: { id: item.id, direction: 1 } }))
                                  }
                                >
                                  <ArrowDown />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid="meeting-agenda-edit"
                                  aria-label={t("meetings.agenda.edit")}
                                  disabled={busy}
                                  onClick={() => {
                                    setAdding(false);
                                    setEditingItem(item.id);
                                  }}
                                >
                                  <Pencil />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  data-testid="meeting-agenda-delete"
                                  aria-label={t("meetings.agenda.delete")}
                                  disabled={busy}
                                  onClick={() => setRemoving(item)}
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            )}
                          </div>
                        )
                      )}
                      <div className="mt-3 min-w-0 border-t pt-3">
                        <h4 className="text-sm font-medium text-muted-foreground">
                          {t("meetings.decisions.title")}
                        </h4>
                        {item.decisions.length === 0 && decisionFor !== item.id && (
                          <p
                            data-testid="meeting-decisions-empty"
                            className="mt-1 text-sm text-muted-foreground"
                          >
                            {t("meetings.decisions.empty")}
                          </p>
                        )}
                        {item.decisions.length > 0 && (
                          <ul className="mt-2 grid min-w-0 grid-cols-1 gap-2">
                            {item.decisions.map((d) => (
                              <li
                                key={d.id}
                                data-testid="meeting-decision"
                                data-decision-id={d.id}
                                className="min-w-0 rounded-lg bg-muted/50 p-3"
                              >
                                {editingDecision === d.id ? (
                                  <DecisionForm
                                    busy={busy}
                                    text={d.text}
                                    onCancel={() => setEditingDecision(null)}
                                    onSave={async (text) => {
                                      if (
                                        await run(
                                          () => updateDecision({ data: { id: d.id, text } }),
                                          t("meetings.decisions.updated"),
                                        )
                                      )
                                        setEditingDecision(null);
                                    }}
                                  />
                                ) : (
                                  <div className="flex min-w-0 items-start gap-2">
                                    <p
                                      data-testid="meeting-decision-text-value"
                                      className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]"
                                    >
                                      {d.text}
                                    </p>
                                    {editable && (
                                      <DecisionActions
                                        busy={busy}
                                        onCreateTask={() => setTaskFor(d)}
                                        onEdit={() => {
                                          setDecisionFor(null);
                                          setEditingDecision(d.id);
                                        }}
                                        onDelete={() =>
                                          void run(
                                            () => removeDecision({ data: { id: d.id } }),
                                            t("meetings.decisions.deleted"),
                                          )
                                        }
                                      />
                                    )}
                                  </div>
                                )}
                                {d.tasks.length > 0 && (
                                  <ul
                                    className="mt-2 grid min-w-0 grid-cols-1 gap-1"
                                    aria-label={t("meetings.decisions.tasks")}
                                  >
                                    {linkedRows(d.tasks).map((row) =>
                                      row.kind === "group" ? (
                                        <TaskGroupLinkedRow
                                          key={row.groupId}
                                          groupId={row.groupId}
                                          testId="meeting-decision-group"
                                          taskLink={(id) => ({
                                            to: "/meetings/$id",
                                            params: { id: meeting.id },
                                            search: { task: id },
                                          })}
                                          editable
                                          onEdit={setEditingGroup}
                                          onDelete={setRemovingGroup}
                                        />
                                      ) : (
                                        <DecisionTaskRow
                                          key={row.task.id}
                                          meetingId={meeting.id}
                                          task={row.task}
                                          busy={busy}
                                          onEdit={(detail) => setEditingTask(detail)}
                                          onDelete={(r) => setRemovingTask(r)}
                                        />
                                      ),
                                    )}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {editable &&
                          (decisionFor === item.id ? (
                            <div className="mt-2">
                              <DecisionForm
                                busy={busy}
                                onCancel={() => setDecisionFor(null)}
                                onSave={async (text) => {
                                  if (
                                    await run(
                                      () => addDecision({ data: { itemId: item.id, text } }),
                                      t("meetings.decisions.added"),
                                    )
                                  )
                                    setDecisionFor(null);
                                }}
                              />
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2 h-10"
                              data-testid="meeting-decision-add"
                              disabled={busy}
                              onClick={() => {
                                setEditingDecision(null);
                                setDecisionFor(item.id);
                              }}
                            >
                              <Plus />
                              {t("meetings.decisions.add")}
                            </Button>
                          ))}
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <EventDialog
        open={!!removing}
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        title={t("meetings.agenda.deleteTitle")}
        testId="meeting-agenda-delete-dialog"
      >
        <p className="text-muted-foreground [overflow-wrap:anywhere]">
          {t("meetings.agenda.deleteText", { title: removing?.title ?? "" })}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            data-testid="meeting-agenda-delete-cancel"
            disabled={busy}
            onClick={() => setRemoving(null)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            data-testid="meeting-agenda-delete-confirm"
            disabled={busy}
            onClick={async () => {
              const item = removing;
              if (
                item &&
                (await run(() => remove({ data: { id: item.id } }), t("meetings.agenda.deleted")))
              )
                setRemoving(null);
            }}
          >
            <Trash2 />
            {t("meetings.agenda.delete")}
          </Button>
        </div>
      </EventDialog>
      <EventDialog
        open={!!removingTask}
        onClose={() => {
          if (!busy) setRemovingTask(null);
        }}
        title={t("tasks.panel.deleteTitle")}
        testId="meeting-decision-task-delete-dialog"
      >
        <p className="text-muted-foreground [overflow-wrap:anywhere]">
          {t("meetings.decisions.deleteTaskText", { title: removingTask?.title ?? "" })}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            data-testid="meeting-decision-task-delete-cancel"
            disabled={busy}
            onClick={() => setRemovingTask(null)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            data-testid="meeting-decision-task-delete-confirm"
            disabled={busy}
            onClick={async () => {
              const row = removingTask;
              if (!row) return;
              const ok = await run(async () => {
                await removeTask({ data: { id: row.id } });
                await Promise.all([
                  qc.invalidateQueries({ queryKey: ["tasks"] }),
                  qc.invalidateQueries({ queryKey: ["recycle-bin"] }),
                ]);
              }, t("tasks.panel.deleted"));
              if (ok) setRemovingTask(null);
            }}
          >
            <Trash2 />
            {t("tasks.panel.delete")}
          </Button>
        </div>
      </EventDialog>
      <TaskGroupFormDialog group={editingGroup} onClose={() => setEditingGroup(null)} />
      <TaskGroupDeleteDialog group={removingGroup} onClose={() => setRemovingGroup(null)} />
      <TaskFormDialog
        open={!!editingTask}
        task={editingTask ?? undefined}
        onClose={() => setEditingTask(null)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ["meeting", meeting.id] });
          void qc.invalidateQueries({ queryKey: ["meeting-series-tasks"] });
        }}
      />
      {taskFor && (
        <TaskFormDialog
          open
          onClose={() => setTaskFor(null)}
          initial={{
            scope: meeting.scope,
            branch_id: meeting.branch_id,
            region_id: meeting.region_id,
            title: taskFor.text.slice(0, 200),
            decision_id: taskFor.id,
          }}
          onSaved={() => {
            setTaskFor(null);
            void qc.invalidateQueries({ queryKey: ["meeting", meeting.id] });
            void qc.invalidateQueries({ queryKey: ["meeting-series-tasks"] });
          }}
        />
      )}
    </section>
  );
}

type DecisionTask = Decision["tasks"][number];

/**
 * A task created from a decision: its title and status open it in the side panel on the meeting page (?task=<id>);
 * Edit and Delete icons appear when the caller may edit the task (can_edit from get_task, the same check the
 * database applies to update_task and delete_task).
 */
function DecisionTaskRow({
  meetingId,
  task,
  busy,
  onEdit,
  onDelete,
}: {
  meetingId: string;
  task: DecisionTask;
  busy: boolean;
  onEdit: (detail: TaskDetail) => void;
  onDelete: (task: DecisionTask) => void;
}) {
  const { t } = useTranslation();
  const fetchTask = useServerFn(getTask);
  // The same cache entry as the side panel.
  const detail = useQuery({
    queryKey: ["tasks", "detail", task.id],
    queryFn: () => fetchTask({ data: { id: task.id } }),
    staleTime: 60000,
  });
  const canEdit = !!detail.data?.can_edit;
  return (
    <li className="flex min-w-0 items-center gap-1" data-testid="meeting-decision-task-row">
      <Link
        to="/meetings/$id"
        params={{ id: meetingId }}
        search={{ task: task.id }}
        resetScroll={false}
        data-testid="meeting-decision-task"
        data-task-id={task.id}
        data-status={task.status}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
      >
        <ListChecks className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={task.title}>
          {task.title}
        </span>
        {detail.data && (
          <AssigneeNames people={detail.data.assignees} testId="meeting-decision-task-assignees" />
        )}
        <TaskStatusBadge status={task.status} className="rounded-full" />
      </Link>
      {canEdit && detail.data && (
        <span className="flex shrink-0 gap-1">
          <Button
            size="icon"
            variant="ghost"
            data-testid="meeting-decision-task-edit"
            aria-label={t("meetings.decisions.editTask", { title: task.title })}
            disabled={busy}
            onClick={() => onEdit(detail.data!)}
          >
            <Pencil />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            data-testid="meeting-decision-task-delete"
            aria-label={t("meetings.decisions.deleteTask", { title: task.title })}
            disabled={busy}
            onClick={() => onDelete(task)}
          >
            <Trash2 />
          </Button>
        </span>
      )}
    </li>
  );
}

function ItemForm({
  busy,
  title: title0 = "",
  notes: notes0 = "",
  onSave,
  onCancel,
}: {
  busy: boolean;
  title?: string;
  notes?: string;
  onSave: (title: string, notes: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(title0),
    [notes, setNotes] = useState(notes0),
    [invalid, setInvalid] = useState(false);
  return (
    <form
      noValidate
      data-testid="meeting-agenda-form"
      className="mt-3 min-w-0 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return setInvalid(true);
        void onSave(title.trim(), notes.trim() || null);
      }}
    >
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="meeting-agenda-title">{t("meetings.agenda.itemTitle")} *</Label>
        <Input
          id="meeting-agenda-title"
          data-testid="meeting-agenda-title"
          value={title}
          maxLength={200}
          aria-invalid={invalid}
          aria-describedby={invalid ? "meeting-agenda-title-error" : undefined}
          disabled={busy}
          onChange={(e) => {
            setTitle(e.target.value);
            setInvalid(false);
          }}
          className="h-11 min-w-0"
        />
        {invalid && (
          <p id="meeting-agenda-title-error" role="alert" className="text-sm text-destructive">
            {t("meetings.agenda.titleRequired")}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="meeting-agenda-notes">{t("meetings.agenda.notes")}</Label>
        <Textarea
          id="meeting-agenda-notes"
          data-testid="meeting-agenda-notes"
          value={notes}
          maxLength={5000}
          rows={3}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          data-testid="meeting-agenda-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" data-testid="meeting-agenda-save" disabled={busy}>
          {busy ? t("common.saving") : t("meetings.agenda.save")}
        </Button>
      </div>
    </form>
  );
}

function DecisionForm({
  busy,
  text: text0 = "",
  onSave,
  onCancel,
}: {
  busy: boolean;
  text?: string;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(text0),
    [invalid, setInvalid] = useState(false);
  return (
    <form
      noValidate
      data-testid="meeting-decision-form"
      className="min-w-0 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return setInvalid(true);
        void onSave(text.trim());
      }}
    >
      <Label htmlFor="meeting-decision-text">{t("meetings.decisions.text")} *</Label>
      <Textarea
        id="meeting-decision-text"
        data-testid="meeting-decision-text"
        value={text}
        maxLength={2000}
        rows={2}
        aria-invalid={invalid}
        aria-describedby={
          invalid
            ? "meeting-decision-text-error meeting-decision-text-hint"
            : "meeting-decision-text-hint"
        }
        disabled={busy}
        onKeyDown={submitOnEnter}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
      />
      <p id="meeting-decision-text-hint" className="text-xs text-muted-foreground">
        {t("common.enterToSave")}
      </p>
      {invalid && (
        <p id="meeting-decision-text-error" role="alert" className="text-sm text-destructive">
          {t("meetings.decisions.textRequired")}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          data-testid="meeting-decision-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" data-testid="meeting-decision-save" disabled={busy}>
          {busy ? t("common.saving") : t("meetings.decisions.save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * A decision's actions (people who may edit the meeting; never trustees): "+ Task" (the task form linked to the
 * decision), Edit and Delete in the decision's row; on phones (< 640 px) the three sit in the decision's ⋯ menu, like
 * the other compact mobile toolbars. One of the two is rendered, so the test ids are the same on every device.
 */
function DecisionActions({
  busy,
  onCreateTask,
  onEdit,
  onDelete,
}: {
  busy: boolean;
  onCreateTask: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const narrow = useNarrowScreen();
  // The task form, the inline editor and the delete run after the menu has closed (a closing modal menu and an opening
  // dialog would otherwise fight over focus and pointer events).
  const after = (fn: () => void) => () => window.setTimeout(fn, 0);
  if (narrow)
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-11 shrink-0"
            data-testid="meeting-decision-menu"
            aria-label={t("meetings.decisions.actions")}
            disabled={busy}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            className="min-h-11"
            data-testid="meeting-decision-create-task"
            onSelect={after(onCreateTask)}
          >
            <Plus />
            {t("meetings.decisions.createTask")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            data-testid="meeting-decision-edit"
            onSelect={after(onEdit)}
          >
            <Pencil />
            {t("meetings.decisions.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11 text-destructive focus:text-destructive"
            data-testid="meeting-decision-delete"
            onSelect={after(onDelete)}
          >
            <Trash2 />
            {t("meetings.decisions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="h-9 gap-1 px-2 text-primary"
        data-testid="meeting-decision-create-task"
        aria-label={t("meetings.decisions.createTask")}
        disabled={busy}
        onClick={onCreateTask}
      >
        <Plus />
        {t("meetings.decisions.taskShort")}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        data-testid="meeting-decision-edit"
        aria-label={t("meetings.decisions.edit")}
        disabled={busy}
        onClick={onEdit}
      >
        <Pencil />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        data-testid="meeting-decision-delete"
        aria-label={t("meetings.decisions.delete")}
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
