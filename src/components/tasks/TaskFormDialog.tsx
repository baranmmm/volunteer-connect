import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_REMINDERS,
  NO_REMINDERS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  buildReminders,
  reminderDraft,
  remindersOn,
  validateReminders,
  type ReminderDraft,
  type ReminderErrors,
  type ReminderSettings,
  type TaskDetail,
  type TaskPriority,
  type TaskStatus,
  type WorkScope,
} from "@/lib/tasks";
import { createTask, createTaskGroup, listTaskPeople, updateTask } from "@/lib/tasks.functions";
import { scopeKey, type WorkScopeOption } from "@/lib/work-scopes";
import { listEvents } from "@/lib/events.functions";
import { eventStart } from "@/lib/event-rules";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EventDialog } from "@/components/events/EventDialog";
import { DateField } from "@/components/events/DateTimeField";
import { ScopeSelect } from "@/components/work/ScopeSelect";
import { useWorkScopes } from "@/components/work/use-work-scopes";
import { PeopleCombobox } from "@/components/work/PeopleCombobox";
import { cn } from "@/lib/utils";
import { ReminderFields } from "./ReminderFields";
import { formatDay, selectClass } from "./task-display";

type Initial = {
  scope: WorkScope;
  branch_id: string | null;
  region_id: string | null;
  title?: string;
  decision_id?: string;
  /** A task from an event page: linked to this event (the scope above is the event's). */
  event_id?: string;
  event_title?: string;
};

/** Roles that hand out tasks; everyone else (volunteers) gets themselves preselected on a new task. */
const MANAGER_ROLES = ["branch_manager", "regional_director", "national_coordinator"];

type FieldErrors = Partial<Record<"title" | "description", string>> & ReminderErrors;

/**
 * Create or edit a task. Only the title, the assignees and the due date are shown at first; "More options" (collapsed
 * on every open) holds the description, priority, status, linked event, scope and reminders. Create mode picks the
 * scope from list_my_work_scopes (the caller's own branch first; fixed when `initial` is given, e.g. a task from a
 * meeting decision or an event); edit mode shows the scope read-only. Someone who can create in only one place
 * (useWorkScopes().single) gets no scope field: that scope is used, and in edit mode no scope line is shown. Reminders are off unless "Remind me" is turned
 * on. The database checks every permission.
 */
export function TaskFormDialog({
  open,
  onClose,
  task,
  initial,
  onSaved,
  onSavedGroup,
}: {
  open: boolean;
  onClose: () => void;
  task?: TaskDetail | undefined;
  initial?: Initial | undefined;
  onSaved?: ((taskId: string) => void) | undefined;
  /** After "@all" created a task group (instead of one task). */
  onSavedGroup?: ((groupId: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <EventDialog
      open={open}
      onClose={onClose}
      title={task ? t("tasks.form.editTitle") : t("tasks.form.createTitle")}
      testId="task-form"
    >
      {open && (
        <TaskForm
          onClose={onClose}
          task={task}
          initial={initial}
          onSaved={onSaved}
          onSavedGroup={onSavedGroup}
        />
      )}
    </EventDialog>
  );
}

function TaskForm({
  onClose,
  task,
  initial,
  onSaved,
  onSavedGroup,
}: {
  onClose: () => void;
  task?: TaskDetail | undefined;
  initial?: Initial | undefined;
  onSaved?: ((taskId: string) => void) | undefined;
  onSavedGroup?: ((groupId: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const { session, profile, roles } = useAuth();
  const uid = session?.user.id;
  const queryClient = useQueryClient();
  const editing = !!task;
  const fixedScope: Initial | null = task
    ? { scope: task.scope, branch_id: task.branch_id, region_id: task.region_id }
    : (initial ?? null);

  const work = useWorkScopes();
  const [chosen, setChosen] = useState<WorkScopeOption | null>(null);
  const scopeOptions = work.scopes;
  const scope = useMemo((): WorkScopeOption | null => {
    if (!fixedScope)
      return (
        chosen ??
        scopeOptions.find((o) => o.scope === "branch" && o.branch_id === profile?.branch_id) ??
        scopeOptions[0] ??
        null
      );
    const label =
      scopeOptions.find((o) => scopeKey(o) === scopeKey(fixedScope))?.label ??
      (task ? (task.scope === "region" ? task.region : task.branch) : null);
    return { ...fixedScope, label };
    // fixedScope is derived from task/initial on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, initial, chosen, scopeOptions, profile?.branch_id]);

  const [title, setTitle] = useState(task?.title ?? initial?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [due, setDue] = useState(task?.due_date ?? "");
  const [assignees, setAssignees] = useState<string[]>(task?.assignees.map((a) => a.id) ?? []);
  const [eventId, setEventId] = useState(task?.event_id ?? initial?.event_id ?? "");
  const [more, setMore] = useState(false);
  // Reminders: off for a new task; an existing task keeps its settings unless they are turned off here.
  const remindersWereOn = !!task && remindersOn(task.reminders);
  const [remind, setRemind] = useState(remindersWereOn);
  const [draft, setDraft] = useState<ReminderDraft>(() =>
    reminderDraft(remindersWereOn ? task.reminders : DEFAULT_REMINDERS),
  );
  // "@all": a task group with one task per active member of the branch (new branch tasks; the branch's managers and,
  // since 20261207090000, any active volunteer of that branch, whose Branch Manager is notified).
  const [allMembers, setAllMembers] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchPeople = useServerFn(listTaskPeople);
  const people = useQuery({
    queryKey: ["tasks", "people", scope ? scopeKey(scope) : null],
    queryFn: () =>
      fetchPeople({
        data: { scope: scope!.scope, branchId: scope!.branch_id, regionId: scope!.region_id },
      }),
    enabled: !!scope,
  });
  // A volunteer's new task is for themselves unless they choose other volunteers of their branch: preselect them.
  const handsOut = roles.some((r) => MANAGER_ROLES.includes(r));
  const branchVolunteer =
    roles.includes("volunteer") && !!profile?.branch_id && profile.branch_id === scope?.branch_id;
  const canAll =
    !task && (handsOut || branchVolunteer) && scope?.scope === "branch" && !!scope.branch_id;
  useEffect(() => {
    if (editing || handsOut || !people.data || !uid) return;
    if (people.data.some((p) => p.id === uid)) setAssignees((cur) => (cur.length ? cur : [uid]));
  }, [editing, handsOut, people.data, uid]);
  // Keep assignees from an earlier state of the list in edit mode (they may no longer be assignable but stay shown).
  const peopleList = useMemo(() => {
    const list = [...(people.data ?? [])];
    for (const a of task?.assignees ?? []) if (!list.some((p) => p.id === a.id)) list.push(a);
    return list;
  }, [people.data, task]);

  const fetchEvents = useServerFn(listEvents);
  const events = useQuery({
    queryKey: ["events", uid, profile?.status],
    queryFn: () => fetchEvents(),
    enabled: profile?.status === "active",
    staleTime: 240000,
  });
  const eventOptions = useMemo(() => {
    if (!scope) return [];
    const same = (events.data ?? []).filter(
      (e) =>
        e.scope === scope.scope &&
        (scope.scope === "national" ||
          (scope.scope === "region"
            ? e.region_id === scope.region_id
            : e.branch_id === scope.branch_id)),
    );
    const options = same.map((e) => {
      const s = eventStart(e);
      const day = s
        ? s.length === 10
          ? s
          : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(s))
        : null;
      return {
        id: e.id,
        label: `${e.title} · ${day ? formatDay(day) : t("tasks.form.unscheduled")}`,
      };
    });
    if (task?.event_id && !options.some((o) => o.id === task.event_id))
      options.unshift({
        id: task.event_id,
        label: task.event_title ?? t("tasks.form.unknownEvent"),
      });
    if (initial?.event_id && !options.some((o) => o.id === initial.event_id))
      options.unshift({
        id: initial.event_id,
        label: initial.event_title ?? t("tasks.form.unknownEvent"),
      });
    return options;
  }, [events.data, scope, task, initial, t]);

  const reminders = buildReminders(draft);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!title.trim()) next.title = "tasks.form.titleRequired";
    else if (title.trim().length > 200) next.title = "tasks.form.titleTooLong";
    if (description.length > 5000) next.description = "tasks.form.descriptionTooLong";
    if (remind && due) Object.assign(next, validateReminders(reminders));
    return next;
  }
  /** What to send: the settings when on; "off" when a new task, or an existing one whose reminders were turned off. */
  function remindersToSend(): { reminders?: ReminderSettings } {
    if (remind && due) return { reminders };
    if (!task || remindersWereOn) return { reminders: NO_REMINDERS };
    return {};
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    const next = validate();
    setErrors(next);
    // Problems in the collapsed section open it, so they can be seen.
    if (Object.keys(next).some((k) => k !== "title")) setMore(true);
    if (Object.keys(next).length || !scope) return;
    const body = {
      title: title.trim(),
      description: description.trim() ? description : null,
      status,
      priority,
      due_date: due || null,
      event_id: eventId || null,
      assignee_ids: assignees,
      ...remindersToSend(),
    };
    setBusy(true);
    try {
      if (canAll && allMembers) {
        const groupId = await createGroup({
          data: {
            branch_id: scope.branch_id!,
            title: body.title,
            description: body.description,
            priority,
            due_date: body.due_date,
            event_id: body.event_id,
            ...(initial?.decision_id ? { decision_id: initial.decision_id } : {}),
            ...(body.reminders ? { reminders: body.reminders } : {}),
          },
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["tasks"] }),
          queryClient.invalidateQueries({ queryKey: ["meeting"] }),
        ]);
        toast.success(t("tasks.groups.created"));
        onSavedGroup?.(groupId);
        onClose();
        return;
      }
      let id: string;
      if (task) {
        await update({ data: { id: task.id, task: body } });
        id = task.id;
      } else {
        id = await create({
          data: {
            ...body,
            scope: scope.scope,
            branch_id: scope.branch_id,
            region_id: scope.region_id,
            ...(initial?.decision_id ? { decision_id: initial.decision_id } : {}),
          },
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(task ? t("tasks.form.saved") : t("tasks.form.created"));
      onSaved?.(id);
      onClose();
    } catch (err) {
      setFormError(translateError(err));
    } finally {
      setBusy(false);
    }
  }
  const create = useServerFn(createTask);
  const createGroup = useServerFn(createTaskGroup);
  const update = useServerFn(updateTask);

  const err = (key: keyof FieldErrors) =>
    errors[key] ? (
      <p
        id={`task-form-${key}-error`}
        className="text-sm text-destructive"
        data-testid={`task-form-${key}-error`}
      >
        {t(errors[key]!)}
      </p>
    ) : null;
  const errId = (key: keyof FieldErrors) => (errors[key] ? `task-form-${key}-error` : undefined);

  if (!fixedScope && work.loading)
    return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (!fixedScope && !work.loading && scopeOptions.length === 0)
    return (
      <p className="text-muted-foreground" data-testid="task-form-no-scopes">
        {t("tasks.form.noScopes")}
      </p>
    );

  return (
    <form
      className="grid min-w-0 grid-cols-1 gap-5"
      onSubmit={submit}
      noValidate
      data-testid="task-form-body"
    >
      {/* A single-scope user is not shown where an edited task lives; a task from an event or a decision says it. */}
      {fixedScope && (initial || !work.single) && (
        <p
          className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]"
          data-testid="task-form-scope-fixed"
          data-scope={scopeKey(fixedScope)}
        >
          {t("work.scope.label")}:{" "}
          {scope!.scope === "national"
            ? t("work.scope.national")
            : scope!.scope === "region"
              ? t("work.scope.regionNamed", { name: scope!.label ?? "" })
              : t("work.scope.branchNamed", { name: scope!.label ?? "" })}
        </p>
      )}
      {initial?.decision_id && !task && (
        <p className="text-sm text-muted-foreground" data-testid="task-form-from-decision">
          {t("tasks.form.fromDecision")}
        </p>
      )}
      {initial?.event_id && !task && (
        <p
          className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]"
          data-testid="task-form-from-event"
        >
          {t("tasks.form.fromEvent", { title: initial.event_title ?? "" })}
        </p>
      )}
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="task-form-title">{t("tasks.form.title")} *</Label>
        <Input
          id="task-form-title"
          data-testid="task-form-title"
          value={title}
          maxLength={200}
          aria-required
          aria-invalid={!!errors.title}
          aria-describedby={errId("title")}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
        {err("title")}
      </div>
      {canAll && (
        <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0"
            data-testid="task-form-all-members"
            checked={allMembers}
            disabled={busy}
            aria-describedby="task-form-all-members-hint"
            onChange={(e) => setAllMembers(e.target.checked)}
          />
          <span className="min-w-0">
            <span className="block font-medium">{t("tasks.groups.allOption")}</span>
            <span
              id="task-form-all-members-hint"
              data-testid="task-form-all-members-hint"
              className="block text-muted-foreground"
            >
              {t(handsOut ? "tasks.groups.allHint" : "tasks.groups.allHintVolunteer")}
            </span>
          </span>
        </label>
      )}
      {!(canAll && allMembers) && (
        <PeopleCombobox
          testId="task-form-assignees"
          label={t("tasks.form.assignees")}
          people={peopleList}
          selected={assignees}
          onChange={setAssignees}
          disabled={busy}
          loading={people.isLoading}
          emptyText={t("tasks.form.assigneesEmpty")}
        />
      )}
      <DateField
        testId="task-form-due-date"
        label={t("tasks.form.dueDate")}
        value={due}
        onChange={setDue}
      />
      <div className="min-w-0 rounded-xl border">
        <button
          type="button"
          data-testid="task-form-more"
          aria-expanded={more}
          aria-controls="task-form-more-section"
          onClick={() => setMore((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-4 py-2 text-left font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("tasks.form.moreOptions")}
          <ChevronDown
            className={cn("size-4 shrink-0 transition-transform", more && "rotate-180")}
            aria-hidden
          />
        </button>
        {more && (
          <div
            id="task-form-more-section"
            data-testid="task-form-more-section"
            className="grid min-w-0 grid-cols-1 gap-5 border-t p-4"
          >
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="task-form-description">{t("tasks.form.description")}</Label>
              <Textarea
                id="task-form-description"
                data-testid="task-form-description"
                value={description}
                maxLength={5000}
                rows={4}
                aria-invalid={!!errors.description}
                aria-describedby={errId("description")}
                onChange={(e) => setDescription(e.target.value)}
              />
              {err("description")}
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              {/* A group's status comes from its members' tasks, so "@all" has no status field. */}
              <div className="min-w-0 space-y-1.5" hidden={canAll && allMembers}>
                <Label htmlFor="task-form-status">{t("tasks.form.status")}</Label>
                <select
                  id="task-form-status"
                  data-testid="task-form-status"
                  className={selectClass}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`tasks.status.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="task-form-priority">{t("tasks.form.priority")}</Label>
                <select
                  id="task-form-priority"
                  data-testid="task-form-priority"
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
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="task-form-event">{t("tasks.form.event")}</Label>
              <select
                id="task-form-event"
                data-testid="task-form-event"
                className={selectClass}
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
              >
                <option value="">{t("tasks.form.noEvent")}</option>
                {eventOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {!fixedScope && !work.single && (
              <ScopeSelect
                id="task-form-scope"
                testId="task-form-scope"
                options={scopeOptions}
                value={scope}
                disabled={busy}
                onChange={(next) => {
                  setChosen(next);
                  setAssignees([]);
                  setEventId("");
                }}
              />
            )}
            <fieldset
              className="min-w-0 space-y-4 rounded-xl border p-4"
              data-testid="task-form-reminders"
              data-on={remind && !!due}
            >
              <legend className="px-1 text-sm font-semibold">{t("tasks.form.reminders")}</legend>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-4"
                  data-testid="task-form-reminders-toggle"
                  checked={remind && !!due}
                  disabled={!due}
                  aria-describedby={due ? undefined : "task-form-reminders-need-due"}
                  onChange={(e) => setRemind(e.target.checked)}
                />
                {t("tasks.form.remindMe")}
              </label>
              {!due && (
                <p
                  id="task-form-reminders-need-due"
                  className="text-sm text-muted-foreground"
                  data-testid="task-form-reminders-need-due"
                >
                  {t("tasks.form.remindersNeedDue")}
                </p>
              )}
              {remind && due && (
                <ReminderFields
                  prefix="task-form"
                  draft={draft}
                  onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                  errors={errors}
                />
              )}
            </fieldset>
          </div>
        )}
      </div>
      {formError && (
        <p
          role="alert"
          className="text-destructive [overflow-wrap:anywhere]"
          data-testid="task-form-error"
        >
          {formError}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          data-testid="task-form-cancel"
          disabled={busy}
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          className="h-11"
          data-testid="task-form-submit"
          disabled={busy || !scope}
        >
          {busy ? t("common.saving") : task ? t("common.save") : t("tasks.form.submitCreate")}
        </Button>
      </div>
    </form>
  );
}
