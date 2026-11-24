import { useTranslation } from "react-i18next";
import {
  BEFORE_DAY_OPTIONS,
  REPEAT_KINDS,
  type ReminderDraft,
  type ReminderErrors,
  type ReminderSettings,
  type RepeatKind,
  reminderSummary,
} from "@/lib/tasks";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/events/DateTimeField";
import { formatDay, selectClass } from "./task-display";

const PRESETS: readonly number[] = BEFORE_DAY_OPTIONS;

/**
 * The reminder options (days before the due date, repeat, overdue) shared by the task form and an assignee's own
 * reminders in the side panel. `prefix` gives every id and test id (`<prefix>-remind-before-3`,
 * `<prefix>-repeat-kind`, `<prefix>-<field>-error`, ...), so both places expose the same option ids.
 */
export function ReminderFields({
  prefix,
  draft,
  onChange,
  errors,
}: {
  prefix: string;
  draft: ReminderDraft;
  onChange: (patch: Partial<ReminderDraft>) => void;
  errors: ReminderErrors;
}) {
  const { t } = useTranslation();
  const errId = (key: keyof ReminderErrors) => (errors[key] ? `${prefix}-${key}-error` : undefined);
  const err = (key: keyof ReminderErrors) =>
    errors[key] ? (
      <p
        id={`${prefix}-${key}-error`}
        className="text-sm text-destructive"
        data-testid={`${prefix}-${key}-error`}
      >
        {t(errors[key]!)}
      </p>
    ) : null;
  const { before, custom, kind, every, start, overdueOn, overdueEvery } = draft;
  return (
    <>
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium" id={`${prefix}-before-label`}>
          {t("tasks.form.remindBefore")}
        </p>
        <div
          className="flex flex-wrap gap-x-4 gap-y-1"
          role="group"
          aria-labelledby={`${prefix}-before-label`}
          aria-describedby={errId("before_days")}
        >
          {PRESETS.map((d) => (
            <label key={d} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                data-testid={`${prefix}-remind-before-${d}`}
                checked={before.includes(d)}
                onChange={(e) =>
                  onChange({
                    before: e.target.checked ? [...before, d] : before.filter((x) => x !== d),
                  })
                }
              />
              {t("tasks.form.daysBefore", { count: d })}
            </label>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Label htmlFor={`${prefix}-remind-custom`} className="text-sm font-normal">
            {t("tasks.form.customDays")}
          </Label>
          <Input
            id={`${prefix}-remind-custom`}
            data-testid={`${prefix}-remind-custom`}
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={custom}
            aria-invalid={!!errors.before_days}
            aria-describedby={errId("before_days")}
            onChange={(e) => onChange({ custom: e.target.value })}
            className="h-11 w-24"
          />
        </div>
        {err("before_days")}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${prefix}-repeat-kind`}>{t("tasks.form.repeat")}</Label>
          <select
            id={`${prefix}-repeat-kind`}
            data-testid={`${prefix}-repeat-kind`}
            className={selectClass}
            value={kind}
            onChange={(e) => onChange({ kind: e.target.value as RepeatKind })}
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
            <Label htmlFor={`${prefix}-repeat-every`}>{t("tasks.form.repeatEvery")}</Label>
            <Input
              id={`${prefix}-repeat-every`}
              data-testid={`${prefix}-repeat-every`}
              type="number"
              inputMode="numeric"
              min={2}
              max={90}
              value={every}
              aria-invalid={!!errors.repeat_every_days}
              aria-describedby={errId("repeat_every_days")}
              onChange={(e) => onChange({ every: e.target.value })}
              className="h-11"
            />
            {err("repeat_every_days")}
          </div>
        )}
        {kind !== "none" && (
          <DateField
            testId={`${prefix}-repeat-start`}
            label={t("tasks.form.repeatStart")}
            value={start}
            onChange={(v) => onChange({ start: v })}
          />
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            data-testid={`${prefix}-overdue-toggle`}
            checked={overdueOn}
            onChange={(e) => onChange({ overdueOn: e.target.checked })}
          />
          {t("tasks.form.overdue")}
        </label>
        {overdueOn && (
          <div className="flex min-w-0 items-center gap-2">
            <Label htmlFor={`${prefix}-overdue-every`} className="text-sm font-normal">
              {t("tasks.form.overdueEvery")}
            </Label>
            <Input
              id={`${prefix}-overdue-every`}
              data-testid={`${prefix}-overdue-every`}
              type="number"
              inputMode="numeric"
              min={1}
              max={90}
              value={overdueEvery}
              aria-invalid={!!errors.overdue_every_days}
              aria-describedby={errId("overdue_every_days")}
              onChange={(e) => onChange({ overdueEvery: e.target.value })}
              className="h-11 w-24"
            />
          </div>
        )}
        {err("overdue_every_days")}
      </div>
    </>
  );
}

/** Reminder settings as read-only lines (the task's reminders and "My reminders" in the side panel). */
export function ReminderLines({ reminders }: { reminders: ReminderSettings }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1 text-sm">
      {reminderSummary(reminders).map((line) => (
        <li key={line.key}>
          {t(line.key, line.date ? { date: formatDay(line.date) } : (line.params ?? {}))}
        </li>
      ))}
    </ul>
  );
}
