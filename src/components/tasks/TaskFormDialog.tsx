import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import {
  BEFORE_DAY_OPTIONS,
  DEFAULT_REMINDERS,
  REPEAT_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  londonDay,
  validateReminders,
  type ReminderErrors,
  type ReminderSettings,
  type RepeatKind,
  type TaskDetail,
  type TaskPriority,
  type TaskStatus,
  type WorkScope,
} from "@/lib/tasks";
import { createTask, listTaskPeople, updateTask } from "@/lib/tasks.functions";
import { listMyWorkScopes, scopeKey, type WorkScopeOption } from "@/lib/work-scopes";
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
import { PersonPicker } from "@/components/work/PersonPicker";
import { formatDay, selectClass } from "./task-display";

type Initial = {
  scope: WorkScope;
  branch_id: string | null;
  region_id: string | null;
  title?: string;
  decision_id?: string;
};

type FieldErrors = Partial<Record<"title" | "description", string>> & ReminderErrors;

const PRESETS: readonly number[] = BEFORE_DAY_OPTIONS;

/** Turns the Reminders inputs into the settings sent to the database (invalid numbers stay invalid for validation). */
function buildReminders(r: {
  before: number[];
  custom: string;
  kind: RepeatKind;
  every: string;
  start: string;
  overdueOn: boolean;
  overdueEvery: string;
}): ReminderSettings {
  const before = [...r.before];
  if (r.custom.trim() !== "") before.push(Number(r.custom));
  return {
    before_days: [...new Set(before)].sort((a, b) => a - b),
    repeat_kind: r.kind,
    repeat_every_days:
      r.kind === "every_n" ? (r.every.trim() === "" ? null : Number(r.every)) : null,
    repeat_start: r.kind === "none" ? null : r.start || londonDay(),
    overdue_every_days: r.overdueOn ? Number(r.overdueEvery) : null,
  };
}

/**
 * Create or edit a task. Create mode picks the scope from list_my_work_scopes (fixed when `initial` is given, e.g. a
 * task from a meeting decision); edit mode shows the scope read-only. The database checks every permission.
 */
export function TaskFormDialog({
  open,
  onClose,
  task,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  task?: TaskDetail | undefined;
  initial?: Initial | undefined;
  onSaved?: ((taskId: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <EventDialog
      open={open}
      onClose={onClose}
      title={task ? t("tasks.form.editTitle") : t("tasks.form.createTitle")}
      testId="task-form"
    >
      {open && <TaskForm onClose={onClose} task={task} initial={initial} onSaved={onSaved} />}
    </EventDialog>
  );
}

function TaskForm({
  onClose,
  task,
  initial,
  onSaved,
}: {
  onClose: () => void;
  task?: TaskDetail | undefined;
  initial?: Initial | undefined;
  onSaved?: ((taskId: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const { session, profile } = useAuth();
  const uid = session?.user.id;
  const queryClient = useQueryClient();
  const editing = !!task;
  const fixedScope: Initial | null = task
    ? { scope: task.scope, branch_id: task.branch_id, region_id: task.region_id }
    : (initial ?? null);

  const fetchScopes = useServerFn(listMyWorkScopes);
  const scopes = useQuery({
    queryKey: ["work-scopes", uid],
    queryFn: () => fetchScopes(),
    enabled: !!uid,
  });
  const [chosen, setChosen] = useState<WorkScopeOption | null>(null);
  const scopeOptions = useMemo(() => scopes.data ?? [], [scopes.data]);
  const scope = useMemo((): WorkScopeOption | null => {
    if (!fixedScope) return chosen ?? scopeOptions[0] ?? null;
    const label =
      scopeOptions.find((o) => scopeKey(o) === scopeKey(fixedScope))?.label ??
      (task ? (task.scope === "region" ? task.region : task.branch) : null);
    return { ...fixedScope, label };
    // fixedScope is derived from task/initial on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, initial, chosen, scopeOptions]);

  const [title, setTitle] = useState(task?.title ?? initial?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [due, setDue] = useState(task?.due_date ?? "");
  const [assignees, setAssignees] = useState<string[]>(task?.assignees.map((a) => a.id) ?? []);
  const [eventId, setEventId] = useState(task?.event_id ?? "");
  const startReminders = task?.reminders ?? DEFAULT_REMINDERS;
  const [before, setBefore] = useState<number[]>(
    startReminders.before_days.filter((d) => PRESETS.includes(d)),
  );
  const [custom, setCustom] = useState(() => {
    const extra = startReminders.before_days.find((d) => !PRESETS.includes(d));
    return extra === undefined ? "" : String(extra);
  });
  const [kind, setKind] = useState<RepeatKind>(startReminders.repeat_kind);
  const [every, setEvery] = useState(
    startReminders.repeat_every_days === null ? "" : String(startReminders.repeat_every_days),
  );
  const [start, setStart] = useState(startReminders.repeat_start ?? londonDay());
  const [overdueOn, setOverdueOn] = useState(startReminders.overdue_every_days !== null);
  const [overdueEvery, setOverdueEvery] = useState(String(startReminders.overdue_every_days ?? 1));
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
  // A volunteer may only assign themselves: preselect them on a new task.
  useEffect(() => {
    if (editing || !people.data) return;
    const only = people.data.length === 1 ? people.data[0] : undefined;
    if (only && only.id === uid) setAssignees((cur) => (cur.length ? cur : [only.id]));
  }, [editing, people.data, uid]);
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
    return options;
  }, [events.data, scope, task, t]);

  const reminders = buildReminders({ before, custom, kind, every, start, overdueOn, overdueEvery });

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!title.trim()) next.title = "tasks.form.titleRequired";
    else if (title.trim().length > 200) next.title = "tasks.form.titleTooLong";
    if (description.length > 5000) next.description = "tasks.form.descriptionTooLong";
    if (due) Object.assign(next, validateReminders(reminders));
    return next;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length || !scope) return;
    const body = {
      title: title.trim(),
      description: description.trim() ? description : null,
      status,
      priority,
      due_date: due || null,
      event_id: eventId || null,
      assignee_ids: assignees,
      ...(due ? { reminders } : {}),
    };
    setBusy(true);
    try {
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

  if (!fixedScope && scopes.isLoading)
    return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (!fixedScope && !scopes.isLoading && scopeOptions.length === 0)
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
      {fixedScope ? (
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
      ) : (
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
      {initial?.decision_id && !task && (
        <p className="text-sm text-muted-foreground" data-testid="task-form-from-decision">
          {t("tasks.form.fromDecision")}
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
        <div className="min-w-0 space-y-1.5">
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
      <DateField
        testId="task-form-due-date"
        label={t("tasks.form.dueDate")}
        value={due}
        onChange={setDue}
      />
      <PersonPicker
        testId="task-form-assignees"
        legend={t("tasks.form.assignees")}
        people={peopleList}
        selected={assignees}
        onChange={setAssignees}
        disabled={busy}
        loading={people.isLoading}
        emptyText={t("tasks.form.assigneesEmpty")}
      />
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
      {due && (
        <fieldset
          className="min-w-0 space-y-4 rounded-xl border p-4"
          data-testid="task-form-reminders"
        >
          <legend className="px-1 text-sm font-semibold">{t("tasks.form.reminders")}</legend>
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-medium" id="task-form-before-label">
              {t("tasks.form.remindBefore")}
            </p>
            <div
              className="flex flex-wrap gap-x-4 gap-y-1"
              role="group"
              aria-labelledby="task-form-before-label"
              aria-describedby={errId("before_days")}
            >
              {PRESETS.map((d) => (
                <label key={d} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    data-testid={`task-form-remind-before-${d}`}
                    checked={before.includes(d)}
                    onChange={(e) =>
                      setBefore((cur) =>
                        e.target.checked ? [...cur, d] : cur.filter((x) => x !== d),
                      )
                    }
                  />
                  {t("tasks.form.daysBefore", { count: d })}
                </label>
              ))}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <Label htmlFor="task-form-remind-custom" className="text-sm font-normal">
                {t("tasks.form.customDays")}
              </Label>
              <Input
                id="task-form-remind-custom"
                data-testid="task-form-remind-custom"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={custom}
                aria-invalid={!!errors.before_days}
                aria-describedby={errId("before_days")}
                onChange={(e) => setCustom(e.target.value)}
                className="h-11 w-24"
              />
            </div>
            {err("before_days")}
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="task-form-repeat-kind">{t("tasks.form.repeat")}</Label>
              <select
                id="task-form-repeat-kind"
                data-testid="task-form-repeat-kind"
                className={selectClass}
                value={kind}
                onChange={(e) => setKind(e.target.value as RepeatKind)}
              >
                {REPEAT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`tasks.form.repeatKinds.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            {kind === "every_n" && (
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="task-form-repeat-every">{t("tasks.form.repeatEvery")}</Label>
                <Input
                  id="task-form-repeat-every"
                  data-testid="task-form-repeat-every"
                  type="number"
                  inputMode="numeric"
                  min={2}
                  max={90}
                  value={every}
                  aria-invalid={!!errors.repeat_every_days}
                  aria-describedby={errId("repeat_every_days")}
                  onChange={(e) => setEvery(e.target.value)}
                  className="h-11"
                />
                {err("repeat_every_days")}
              </div>
            )}
            {kind !== "none" && (
              <DateField
                testId="task-form-repeat-start"
                label={t("tasks.form.repeatStart")}
                value={start}
                onChange={setStart}
              />
            )}
          </div>
          <div className="min-w-0 space-y-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4"
                data-testid="task-form-overdue-toggle"
                checked={overdueOn}
                onChange={(e) => setOverdueOn(e.target.checked)}
              />
              {t("tasks.form.overdue")}
            </label>
            {overdueOn && (
              <div className="flex min-w-0 items-center gap-2">
                <Label htmlFor="task-form-overdue-every" className="text-sm font-normal">
                  {t("tasks.form.overdueEvery")}
                </Label>
                <Input
                  id="task-form-overdue-every"
                  data-testid="task-form-overdue-every"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={90}
                  value={overdueEvery}
                  aria-invalid={!!errors.overdue_every_days}
                  aria-describedby={errId("overdue_every_days")}
                  onChange={(e) => setOverdueEvery(e.target.value)}
                  className="h-11 w-24"
                />
              </div>
            )}
            {err("overdue_every_days")}
          </div>
        </fieldset>
      )}
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
