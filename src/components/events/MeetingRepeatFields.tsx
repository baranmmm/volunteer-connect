import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_MEETING_OCCURRENCES } from "@/lib/meetings";
import type { MeetingRepeatState } from "@/lib/event-meeting-repeat";

/**
 * Repeat of a meeting created from the event form: does not repeat / weekly / monthly, every 1-4, 2-52 occurrences.
 * Test ids: `event-form-meeting-repeat-freq` (options `-option-<freq>`), `event-form-meeting-repeat-interval` (options
 * `-option-<n>`), `event-form-meeting-repeat-count`.
 */
export function MeetingRepeatFields({
  value,
  onChange,
  disabled,
  error,
}: {
  value: MeetingRepeatState;
  onChange: (value: MeetingRepeatState) => void;
  disabled?: boolean;
  error?: string | undefined;
}) {
  const { t } = useTranslation();
  const unit = value.freq === "monthly" ? "month" : "week";
  return (
    <div data-testid="event-form-meeting-repeat" className="min-w-0 space-y-4">
      <div className="space-y-1.5">
        <Label>{t("events.repeat.label")}</Label>
        <Select
          value={value.freq}
          disabled={!!disabled}
          onValueChange={(v) =>
            onChange({ ...value, freq: v === "weekly" || v === "monthly" ? v : "none" })
          }
        >
          <SelectTrigger
            data-testid="event-form-meeting-repeat-freq"
            aria-label={t("events.repeat.label")}
            className="h-11"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["none", "weekly", "monthly"] as const).map((f) => (
              <SelectItem
                key={f}
                value={f}
                data-testid={`event-form-meeting-repeat-freq-option-${f}`}
              >
                {t(`events.meetingRepeat.freq.${f}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {value.freq !== "none" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("events.meetingRepeat.every")}</Label>
            <Select
              value={String(value.interval)}
              disabled={!!disabled}
              onValueChange={(v) => onChange({ ...value, interval: Number(v) || 1 })}
            >
              <SelectTrigger
                data-testid="event-form-meeting-repeat-interval"
                aria-label={t("events.meetingRepeat.every")}
                className="h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((n) => (
                  <SelectItem
                    key={n}
                    value={String(n)}
                    data-testid={`event-form-meeting-repeat-interval-option-${n}`}
                  >
                    {`${n} ${t(`events.repeat.unit.${unit}`, { count: n })}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="event-form-meeting-repeat-count">
              {t("events.meetingRepeat.count")}
            </Label>
            <Input
              id="event-form-meeting-repeat-count"
              data-testid="event-form-meeting-repeat-count"
              type="number"
              min={2}
              max={MAX_MEETING_OCCURRENCES}
              step={1}
              inputMode="numeric"
              value={value.count}
              disabled={!!disabled}
              onChange={(e) => onChange({ ...value, count: e.target.value })}
              aria-invalid={!!error}
              aria-describedby={
                error
                  ? "event-form-meeting-repeat-count-error"
                  : "event-form-meeting-repeat-count-hint"
              }
              className="h-11 min-w-0"
            />
            <p id="event-form-meeting-repeat-count-hint" className="text-xs text-muted-foreground">
              {t("events.meetingRepeat.countHint")}
            </p>
            {error && (
              <p
                id="event-form-meeting-repeat-count-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {t(error)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
