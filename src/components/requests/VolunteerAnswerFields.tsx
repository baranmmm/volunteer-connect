import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  APPLICATION_LIMITS,
  TIME_COMMITMENTS,
  type TimeCommitment,
  type VolunteerAnswerErrors,
  type VolunteerAnswers,
} from "@/lib/volunteer-applications";

/**
 * The three required answers of a volunteer application ("How would you like to help?", "How much time can you
 * give?", the commitment), shared by the sign-up form and "Become a Dialogue Society volunteer". `prefix` gives the
 * element ids and test ids (`signup-volunteer`, `volunteer-form`).
 */
export function VolunteerAnswerFields({
  prefix,
  value,
  errors,
  onChange,
}: {
  prefix: string;
  value: VolunteerAnswers;
  errors: VolunteerAnswerErrors;
  onChange: (next: VolunteerAnswers) => void;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof VolunteerAnswers>(key: K, v: VolunteerAnswers[K]) =>
    onChange({ ...value, [key]: v });
  const errorId = (key: keyof VolunteerAnswers) => `${prefix}-${key}-error`;
  const error = (key: keyof VolunteerAnswers) =>
    errors[key] ? (
      <p
        id={errorId(key)}
        data-testid={`${prefix}-${key}-error`}
        role="alert"
        className="text-sm font-medium text-destructive"
      >
        {t(errors[key]!)}
      </p>
    ) : null;
  const helpLength = value.help.trim().length;
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-help`}>{t("applications.fields.help")} *</Label>
        <Textarea
          id={`${prefix}-help`}
          data-testid={`${prefix}-help`}
          value={value.help}
          maxLength={APPLICATION_LIMITS.helpMax}
          rows={4}
          aria-required
          aria-invalid={!!errors.help}
          aria-describedby={[`${prefix}-help-hint`, errors.help ? errorId("help") : ""]
            .filter(Boolean)
            .join(" ")}
          onChange={(e) => set("help", e.target.value)}
        />
        <p id={`${prefix}-help-hint`} className="text-xs text-muted-foreground">
          {t("applications.helpHint", {
            min: APPLICATION_LIMITS.helpMin,
            max: APPLICATION_LIMITS.helpMax,
            length: helpLength,
          })}
        </p>
        {error("help")}
      </div>
      <fieldset
        data-testid={`${prefix}-time`}
        aria-describedby={errors.time ? errorId("time") : undefined}
        className="space-y-2"
      >
        <legend className="mb-2 text-sm font-medium">{t("applications.fields.time")} *</legend>
        {TIME_COMMITMENTS.map((option) => (
          <label
            key={option}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary"
          >
            <input
              type="radio"
              name={`${prefix}-time`}
              value={option}
              data-testid={`${prefix}-time-${option}`}
              checked={value.time === option}
              onChange={() => set("time", option as TimeCommitment)}
              className="size-4 accent-[var(--primary)]"
            />
            {t(`applications.time.${option}`)}
          </label>
        ))}
        {error("time")}
      </fieldset>
      <div className="space-y-1.5">
        <div className="flex items-start gap-3">
          <Checkbox
            id={`${prefix}-commitment`}
            data-testid={`${prefix}-commitment`}
            checked={value.commitment}
            aria-required
            aria-invalid={!!errors.commitment}
            aria-describedby={errors.commitment ? errorId("commitment") : undefined}
            onCheckedChange={(v) => set("commitment", v === true)}
          />
          <Label htmlFor={`${prefix}-commitment`} className="leading-snug">
            {t("applications.fields.commitment")} *
          </Label>
        </div>
        {error("commitment")}
      </div>
    </div>
  );
}
