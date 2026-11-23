import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { londonInput, londonToIso } from "@/lib/event-rules";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks";
import type { RequestTarget } from "@/lib/work-requests";
import { submitMeetingRequest, submitTaskRequest } from "@/lib/work-requests.functions";
import { useRequestTargets, WORK_REQUEST_KEYS } from "@/lib/use-work-notices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EventDialog } from "@/components/events/EventDialog";
import { DateField, DateTimeField } from "@/components/events/DateTimeField";

const MAX_TIMES = 3;
type FormProps = { onClose: () => void; onSaved: (id: string) => void };

/** The person a request goes to: name (cut on one line, full name in the tooltip) and role. */
function TargetSelect({
  testId,
  value,
  onChange,
  targets,
  disabled,
}: {
  testId: string;
  value: string;
  onChange: (id: string) => void;
  targets: RequestTarget[];
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={testId}>{t("workRequests.form.target")} *</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={testId} data-testid={testId} aria-required className="h-11 min-w-0">
          <SelectValue placeholder={t("workRequests.form.targetPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {targets.map((p) => {
            const name = p.full_name || t("common.unnamed");
            return (
              <SelectItem
                key={p.id}
                value={p.id}
                data-testid={`${testId}-option`}
                data-user-id={p.id}
                className="min-w-0"
              >
                <span className="flex min-w-0 max-w-[16rem] items-baseline gap-1 sm:max-w-sm">
                  <span title={name} className="min-w-0 truncate">
                    {name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    · {t(`common.roles.${p.role}`)}
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t("workRequests.form.targetHint")}</p>
    </div>
  );
}

function FormError({ testId, message }: { testId: string; message: string }) {
  if (!message) return null;
  return (
    <p data-testid={testId} role="alert" className="break-words text-sm text-destructive">
      {message}
    </p>
  );
}

function FormButtons({
  prefix,
  busy,
  onClose,
  submitLabel,
}: {
  prefix: string;
  busy: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
      <Button
        type="button"
        variant="outline"
        data-testid={`${prefix}-cancel`}
        disabled={busy}
        onClick={onClose}
        className="h-11"
      >
        {t("common.cancel")}
      </Button>
      <Button type="submit" data-testid={`${prefix}-submit`} disabled={busy} className="h-11">
        {busy ? t("common.saving") : submitLabel}
      </Button>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Ask someone higher in the chain to take on a task. Accepting creates a task assigned to them. */
export function TaskRequestForm({ onClose, onSaved }: FormProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const submitFn = useServerFn(submitTaskRequest);
  const targets = useRequestTargets();
  const [target, setTarget] = useState(""),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [priority, setPriority] = useState<TaskPriority>("medium"),
    [due, setDue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!target) return setError(t("workRequests.errors.target"));
    if (!title.trim()) return setError(t("workRequests.errors.title"));
    setBusy(true);
    setError("");
    try {
      const id = await submitFn({
        data: {
          target_id: target,
          title: title.trim(),
          description: description.trim() || null,
          priority,
          due_date: due || null,
        },
      });
      await Promise.all(WORK_REQUEST_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })));
      toast.success(t("workRequests.submittedToast"));
      onSaved(id);
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <EventDialog open onClose={() => !busy && onClose()} title={t("workRequests.form.taskTitle")}>
      <form
        data-testid="task-request-form"
        noValidate
        onSubmit={(e) => void submit(e)}
        className="space-y-4"
      >
        <p className="text-sm text-muted-foreground">{t("workRequests.form.taskIntro")}</p>
        <TargetSelect
          testId="task-request-target"
          value={target}
          onChange={setTarget}
          targets={targets.data ?? []}
          disabled={busy}
        />
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="task-request-title">{t("workRequests.form.title")} *</Label>
          <Input
            id="task-request-title"
            data-testid="task-request-title"
            value={title}
            maxLength={200}
            aria-required
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11"
          />
        </div>
        <Field id="task-request-description" label={t("workRequests.form.description")}>
          <Textarea
            id="task-request-description"
            data-testid="task-request-description"
            value={description}
            maxLength={5000}
            rows={4}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="task-request-priority" label={t("workRequests.form.priority")}>
            <Select
              value={priority}
              disabled={busy}
              onValueChange={(v) => {
                const next = TASK_PRIORITIES.find((p) => p === v);
                if (next) setPriority(next);
              }}
            >
              <SelectTrigger
                id="task-request-priority"
                data-testid="task-request-priority"
                className="h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p} data-testid={`task-request-priority-${p}`}>
                    {t(`workRequests.priorities.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DateField
            testId="task-request-due-date"
            label={t("workRequests.form.dueDate")}
            value={due}
            onChange={setDue}
            disabled={busy}
          />
        </div>
        <FormError testId="task-request-error" message={error} />
        <FormButtons
          prefix="task-request"
          busy={busy}
          onClose={onClose}
          submitLabel={t("workRequests.form.submit")}
        />
      </form>
    </EventDialog>
  );
}

type TimeRow = { key: string; start: string; end: string; endTouched: boolean };
const emptyRow = (): TimeRow => ({
  key: crypto.randomUUID(),
  start: "",
  end: "",
  endTouched: false,
});
/** London "YYYY-MM-DDTHH:mm" from the date and time inputs (or a partial value while typing). */
const combine = (d: string, tm: string) =>
  d && tm ? `${d}T${tm}` : d ? `${d}T` : tm ? `T${tm}` : "";

/** Ask someone higher in the chain for a meeting, with up to three proposed times (London time). */
export function MeetingRequestForm({ onClose, onSaved }: FormProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const submitFn = useServerFn(submitMeetingRequest);
  const targets = useRequestTargets();
  const [target, setTarget] = useState(""),
    [topic, setTopic] = useState(""),
    [note, setNote] = useState(""),
    [times, setTimes] = useState<TimeRow[]>(() => [emptyRow()]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  function setStart(index: number, value: string) {
    setTimes((cur) =>
      cur.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, start: value };
        if (!row.endTouched && value.length === 16)
          try {
            next.end = londonInput(new Date(Date.parse(londonToIso(value)) + 3600 * 1000));
          } catch {
            /* reported on submit */
          }
        return next;
      }),
    );
  }
  const setEnd = (index: number, value: string) =>
    setTimes((cur) =>
      cur.map((row, i) => (i === index ? { ...row, end: value, endTouched: true } : row)),
    );

  /** The proposed times as ISO instants, or an i18n error key. */
  function proposed(): { starts_at: string; ends_at: string }[] | string {
    const out: { starts_at: string; ends_at: string }[] = [];
    for (const row of times) {
      if (!row.start && !row.end) continue;
      if (row.start.length !== 16 || row.end.length !== 16)
        return "workRequests.errors.timeIncomplete";
      let starts_at: string, ends_at: string;
      try {
        starts_at = londonToIso(row.start);
        ends_at = londonToIso(row.end);
      } catch {
        return "workRequests.errors.timeIncomplete";
      }
      if (Date.parse(ends_at) <= Date.parse(starts_at)) return "workRequests.errors.endAfterStart";
      out.push({ starts_at, ends_at });
    }
    return out;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!target) return setError(t("workRequests.errors.target"));
    if (!topic.trim()) return setError(t("workRequests.errors.topic"));
    const proposedTimes = proposed();
    if (typeof proposedTimes === "string") return setError(t(proposedTimes));
    setBusy(true);
    setError("");
    try {
      const id = await submitFn({
        data: {
          target_id: target,
          topic: topic.trim(),
          note: note.trim() || null,
          proposed_times: proposedTimes,
        },
      });
      await Promise.all(WORK_REQUEST_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })));
      toast.success(t("workRequests.submittedToast"));
      onSaved(id);
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  const dateTime = (
    prefix: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <DateTimeField
      testIdPrefix={prefix}
      legend={label}
      dateLabel={`${label} – ${t("requests.dateLabel")}`}
      timeLabel={`${label} – ${t("requests.timeLabel")}`}
      placeholder={t("events.timePlaceholder")}
      day={value.slice(0, 10)}
      time={value.slice(11, 16)}
      onChange={(d, tm) => onChange(combine(d, tm))}
      disabled={busy}
    />
  );

  return (
    <EventDialog
      open
      onClose={() => !busy && onClose()}
      title={t("workRequests.form.meetingTitle")}
    >
      <form
        data-testid="meeting-request-form"
        noValidate
        onSubmit={(e) => void submit(e)}
        className="space-y-4"
      >
        <p className="text-sm text-muted-foreground">{t("workRequests.form.meetingIntro")}</p>
        <TargetSelect
          testId="meeting-request-target"
          value={target}
          onChange={setTarget}
          targets={targets.data ?? []}
          disabled={busy}
        />
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="meeting-request-topic">{t("workRequests.form.topic")} *</Label>
          <Input
            id="meeting-request-topic"
            data-testid="meeting-request-topic"
            value={topic}
            maxLength={200}
            aria-required
            disabled={busy}
            onChange={(e) => setTopic(e.target.value)}
            className="h-11"
          />
        </div>
        <Field id="meeting-request-note" label={t("workRequests.form.note")}>
          <Textarea
            id="meeting-request-note"
            data-testid="meeting-request-note"
            value={note}
            maxLength={2000}
            rows={3}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <fieldset className="min-w-0 space-y-3">
          <legend className="text-sm font-medium">{t("workRequests.form.proposedTimes")}</legend>
          <p className="text-xs text-muted-foreground">{t("workRequests.form.proposedHint")}</p>
          {times.map((row, index) => {
            const n = index + 1;
            return (
              <div
                key={row.key}
                data-testid={`meeting-request-time-${n}`}
                className="min-w-0 space-y-3 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t("workRequests.form.timeOption", { n })}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="meeting-request-remove-time"
                    disabled={busy}
                    onClick={() => setTimes((cur) => cur.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 />
                    {t("workRequests.form.removeTime")}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {dateTime(`meeting-request-time-${n}-start`, t("events.start"), row.start, (v) =>
                    setStart(index, v),
                  )}
                  {dateTime(`meeting-request-time-${n}-end`, t("events.end"), row.end, (v) =>
                    setEnd(index, v),
                  )}
                </div>
              </div>
            );
          })}
          {times.length < MAX_TIMES && (
            <Button
              type="button"
              variant="outline"
              data-testid="meeting-request-add-time"
              disabled={busy}
              onClick={() => setTimes((cur) => [...cur, emptyRow()])}
            >
              <Plus />
              {t("workRequests.form.addTime")}
            </Button>
          )}
        </fieldset>
        <FormError testId="meeting-request-error" message={error} />
        <FormButtons
          prefix="meeting-request"
          busy={busy}
          onClose={onClose}
          submitLabel={t("workRequests.form.submit")}
        />
      </form>
    </EventDialog>
  );
}
