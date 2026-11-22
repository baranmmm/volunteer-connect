import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateLocale } from "@/lib/i18n";
import {
  buildRule,
  describeRule,
  nthWeekdayOf,
  weekdayOf,
  WEEKDAYS,
  type RepeatEnds,
  type RepeatFreq,
  type RepeatStart,
  type RepeatState,
  type RepeatUnit,
  type Weekday,
} from "@/lib/recurrence";

const FREQS: RepeatFreq[] = ["none", "daily", "weekly", "monthly", "yearly", "custom"];
const UNITS: RepeatUnit[] = ["day", "week", "month"];
const ENDS: RepeatEnds[] = ["never", "on", "after"];

/** Google Calendar style repeat controls with a live EN/TR summary. */
export function RepeatFields({
  value,
  onChange,
  start,
  disabled,
  errors,
}: {
  value: RepeatState;
  onChange: (next: RepeatState) => void;
  start: RepeatStart;
  disabled: boolean;
  errors: Record<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const set = (patch: Partial<RepeatState>) => onChange({ ...value, ...patch });
  const weekly = value.freq === "weekly" || (value.freq === "custom" && value.unit === "week");
  const monthly = value.freq === "monthly" || (value.freq === "custom" && value.unit === "month");
  const startDay = start.date ? weekdayOf(start.date) : null;
  const dayName = (d: Weekday) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(d), 12)),
    );
  const longDay = (d: Weekday) => {
    const name = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(d), 12)),
    );
    return locale.startsWith("tr") ? name.toLocaleLowerCase("tr") : name; // Turkish weekdays are lower case mid-sentence
  };
  const rule = buildRule(value, start);
  const error = (key: string) =>
    errors[key] ? (
      <p id={`event-form-${key}-error`} role="alert" className="text-sm text-destructive">
        {t(errors[key])}
      </p>
    ) : null;

  return (
    <fieldset className="space-y-3 rounded-lg border p-3" disabled={disabled}>
      <legend className="flex items-center gap-2 px-1 text-sm font-medium">
        <Repeat className="size-4" aria-hidden />
        {t("events.repeat.label")}
      </legend>
      <Select
        value={value.freq}
        onValueChange={(v) =>
          set({
            freq: v as RepeatFreq,
            weekdays:
              v === "weekly" && startDay && !value.weekdays.length ? [startDay] : value.weekdays,
          })
        }
      >
        <SelectTrigger
          data-testid="event-form-repeat"
          aria-label={t("events.repeat.label")}
          className="h-11"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FREQS.map((f) => (
            <SelectItem key={f} value={f} data-testid={`event-form-repeat-option-${f}`}>
              {t(`events.repeat.freq.${f}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value.freq === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="event-form-repeat-interval">{t("events.repeat.every")}</Label>
          <Input
            id="event-form-repeat-interval"
            data-testid="event-form-repeat-interval"
            type="number"
            min={1}
            max={999}
            className="h-11 w-24"
            value={value.interval}
            onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })}
          />
          <Select value={value.unit} onValueChange={(v) => set({ unit: v as RepeatUnit })}>
            <SelectTrigger
              data-testid="event-form-repeat-unit"
              aria-label={t("events.repeat.unitLabel")}
              className="h-11 w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u} data-testid={`event-form-repeat-unit-option-${u}`}>
                  {t(`events.repeat.unit.${u}`, { count: value.interval })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {weekly && (
        <div role="group" aria-label={t("events.repeat.onDays")} className="flex flex-wrap gap-1">
          {WEEKDAYS.map((d) => {
            const on = value.weekdays.length ? value.weekdays.includes(d) : d === startDay;
            return (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                aria-label={longDay(d)}
                data-testid={`event-form-repeat-day-${d}`}
                onClick={() => {
                  const current = value.weekdays.length
                    ? value.weekdays
                    : startDay
                      ? [startDay]
                      : [];
                  const next = on ? current.filter((x) => x !== d) : [...current, d];
                  set({ weekdays: next.length ? next : current });
                }}
              >
                {dayName(d)}
              </Button>
            );
          })}
        </div>
      )}

      {monthly && start.date && (
        <Select
          value={value.monthly}
          onValueChange={(v) => set({ monthly: v === "weekday" ? "weekday" : "day" })}
        >
          <SelectTrigger
            data-testid="event-form-repeat-monthly"
            aria-label={t("events.repeat.monthlyLabel")}
            className="h-11"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day" data-testid="event-form-repeat-monthly-option-day">
              {t("events.repeat.monthlyDay", { day: Number(start.date.slice(8, 10)) })}
            </SelectItem>
            <SelectItem value="weekday" data-testid="event-form-repeat-monthly-option-weekday">
              {t("events.repeat.monthlyWeekday", {
                nth: t(`events.repeat.nth.${nthWeekdayOf(start.date)}`),
                weekday: longDay(weekdayOf(start.date)),
              })}
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      {value.freq !== "none" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("events.repeat.ends")}</Label>
            <Select value={value.ends} onValueChange={(v) => set({ ends: v as RepeatEnds })}>
              <SelectTrigger
                data-testid="event-form-repeat-ends"
                aria-label={t("events.repeat.ends")}
                className="h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENDS.map((e) => (
                  <SelectItem key={e} value={e} data-testid={`event-form-repeat-ends-option-${e}`}>
                    {t(`events.repeat.endsOption.${e}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {value.ends === "on" && (
            <div className="space-y-1.5">
              <Label htmlFor="event-form-repeat-until">{t("events.repeat.untilLabel")}</Label>
              <Input
                id="event-form-repeat-until"
                data-testid="event-form-repeat-until"
                type="date"
                className="h-11"
                value={value.until}
                min={start.date || undefined}
                onChange={(e) => set({ until: e.target.value })}
                aria-invalid={!!errors["repeat-until"]}
              />
              {error("repeat-until")}
            </div>
          )}
          {value.ends === "after" && (
            <div className="space-y-1.5">
              <Label htmlFor="event-form-repeat-count">{t("events.repeat.countLabel")}</Label>
              <Input
                id="event-form-repeat-count"
                data-testid="event-form-repeat-count"
                type="number"
                min={1}
                max={1000}
                className="h-11"
                value={value.count}
                onChange={(e) => set({ count: Number(e.target.value) || 0 })}
                aria-invalid={!!errors["repeat-count"]}
              />
              {error("repeat-count")}
            </div>
          )}
        </div>
      )}

      <p
        data-testid="event-repeat-summary"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        {describeRule(rule, start, t, locale)}
      </p>
    </fieldset>
  );
}
