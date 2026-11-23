import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimeSelect } from "./TimeSelect";

/**
 * The one Start/End control used by every event and request form: a London date input plus the quarter-hour time
 * list, side by side (also at 375px). Test ids: `<testIdPrefix>-date` and `<testIdPrefix>-time`.
 */
export function DateTimeField({
  testIdPrefix,
  legend,
  dateLabel,
  timeLabel,
  placeholder,
  day,
  time,
  onChange,
  required = false,
  disabled = false,
  errorId,
  error,
}: {
  testIdPrefix: string;
  legend: string;
  dateLabel: string;
  timeLabel: string;
  placeholder: string;
  day: string;
  time: string;
  onChange: (day: string, time: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Set when the field has an error: the id of the rendered `error` element. */
  errorId?: string | undefined;
  error?: ReactNode;
}) {
  const invalid = !!errorId;
  return (
    <fieldset className="min-w-0 space-y-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium leading-none">
        {legend}
        {required && " *"}
      </legend>
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
        <Input
          id={`${testIdPrefix}-date`}
          data-testid={`${testIdPrefix}-date`}
          type="date"
          aria-label={dateLabel}
          aria-required={required}
          aria-invalid={invalid}
          aria-describedby={errorId}
          value={day}
          onChange={(e) => onChange(e.target.value, time)}
          className="h-11 min-w-0"
        />
        <TimeSelect
          id={`${testIdPrefix}-time`}
          testId={`${testIdPrefix}-time`}
          label={timeLabel}
          placeholder={placeholder}
          value={time}
          onChange={(value) => onChange(day, value)}
          disabled={disabled}
          invalid={invalid}
          describedBy={errorId}
        />
      </div>
      {error}
    </fieldset>
  );
}

/** All-day Start/End: a London calendar date (`<testId>`); End is optional and defaults to Start. */
export function DateField({
  testId,
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  errorId,
  error,
}: {
  testId: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  errorId?: string | undefined;
  error?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={testId}>
        {label}
        {required && " *"}
      </Label>
      <Input
        id={testId}
        data-testid={testId}
        type="date"
        aria-required={required}
        aria-invalid={!!errorId}
        aria-describedby={errorId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 min-w-0"
      />
      {error}
    </div>
  );
}
