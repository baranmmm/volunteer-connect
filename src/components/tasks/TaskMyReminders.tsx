import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { BellPlus, Pencil, Trash2 } from "lucide-react";
import {
  DEFAULT_REMINDERS,
  buildReminders,
  reminderDraft,
  remindersOn,
  validateReminders,
  type ReminderDraft,
  type ReminderErrors,
  type ReminderSettings,
  type TaskDetail,
} from "@/lib/tasks";
import { setMyTaskReminders } from "@/lib/tasks.functions";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { ReminderFields, ReminderLines } from "./ReminderFields";

const PREFIX = "task-panel-my-reminders";

/**
 * An assignee's own reminders on a task assigned to them (set_my_task_reminders): only for them, next to the task's
 * reminders, with the same options as the task form. Off until they add one; they need a due date. Muting the task's
 * reminders does not silence these.
 */
export function TaskMyReminders({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const save = useServerFn(setMyTaskReminders);
  const mine = task.my_reminders ?? null;
  const [draft, setDraft] = useState<ReminderDraft | null>(null);
  const [errors, setErrors] = useState<ReminderErrors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  function edit() {
    setErrors({});
    setFormError("");
    setDraft(reminderDraft(mine ?? DEFAULT_REMINDERS));
  }

  async function store(reminders: ReminderSettings | null) {
    setBusy(true);
    setFormError("");
    try {
      const result = await save({ data: { id: task.id, reminders } });
      queryClient.setQueryData(["tasks", "detail", task.id], {
        ...task,
        my_reminders: result.reminders,
      });
      toast.success(
        reminders ? t("tasks.panel.myReminders.saved") : t("tasks.panel.myReminders.removed"),
      );
      setDraft(null);
    } catch (e) {
      setFormError(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const reminders = buildReminders(draft);
    const next = validateReminders(reminders);
    setErrors(next);
    if (Object.keys(next).length) return;
    if (!remindersOn(reminders)) {
      setFormError(t("tasks.panel.myReminders.pickOne"));
      return;
    }
    void store(reminders);
  }

  const removeButton = mine && (
    <Button
      type="button"
      variant="outline"
      className="h-11 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
      data-testid={`${PREFIX}-remove`}
      disabled={busy}
      onClick={() => void store(null)}
    >
      <Trash2 />
      {t("tasks.panel.myReminders.remove")}
    </Button>
  );

  return (
    <section
      className="min-w-0 space-y-3 rounded-xl border p-3"
      data-testid={PREFIX}
      data-on={!!mine}
      aria-labelledby={`${PREFIX}-title`}
    >
      <div className="space-y-1">
        <h3 id={`${PREFIX}-title`} className="text-sm font-semibold">
          {t("tasks.panel.myReminders.title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("tasks.panel.myReminders.hint")}</p>
      </div>
      {!task.due_date ? (
        <>
          <p className="text-sm text-muted-foreground" data-testid={`${PREFIX}-need-due`}>
            {t("tasks.panel.myReminders.needDue")}
          </p>
          {removeButton}
        </>
      ) : draft ? (
        <form
          className="grid min-w-0 grid-cols-1 gap-4"
          data-testid={`${PREFIX}-form`}
          onSubmit={submit}
          noValidate
        >
          <ReminderFields
            prefix={PREFIX}
            draft={draft}
            onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
            errors={errors}
          />
          {formError && (
            <p
              role="alert"
              className="text-sm text-destructive [overflow-wrap:anywhere]"
              data-testid={`${PREFIX}-error`}
            >
              {formError}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="submit" className="h-11" data-testid={`${PREFIX}-save`} disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              data-testid={`${PREFIX}-cancel`}
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              {t("common.cancel")}
            </Button>
            {removeButton}
          </div>
        </form>
      ) : mine ? (
        <>
          <div data-testid={`${PREFIX}-summary`}>
            <ReminderLines reminders={mine} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              data-testid={`${PREFIX}-edit`}
              onClick={edit}
            >
              <Pencil />
              {t("tasks.panel.myReminders.edit")}
            </Button>
            {removeButton}
          </div>
          {formError && (
            <p role="alert" className="text-sm text-destructive" data-testid={`${PREFIX}-error`}>
              {formError}
            </p>
          )}
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-11"
          data-testid={`${PREFIX}-add`}
          onClick={edit}
        >
          <BellPlus />
          {t("tasks.panel.myReminders.add")}
        </Button>
      )}
    </section>
  );
}
