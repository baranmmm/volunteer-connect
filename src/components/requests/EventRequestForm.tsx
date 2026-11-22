import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { londonInput, londonToIso } from "@/lib/event-rules";
import {
  emptyRequestForm,
  requestFormFromRow,
  requestPayload,
  validateRequestForm,
  REQUEST_DESCRIPTION_MAX,
  REQUEST_REASON_MAX,
  REQUEST_TITLE_MAX,
  type EventRequest,
  type RequestFormFields,
} from "@/lib/event-requests";
import { submitEventRequest, updateEventRequest } from "@/lib/event-requests.functions";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EventDialog } from "@/components/events/EventDialog";
import { TimeSelect } from "@/components/events/TimeSelect";

const P = "event-request-form";
const ORDER = [
  "title",
  "start",
  "end",
  "start-date",
  "end-date",
  "alt-start",
  "alt-end",
  "alt-start-date",
  "alt-end-date",
  "location",
  "online-url",
  "expected-attendees",
  "description",
  "reason",
];

/** Volunteers request a branch event, branch managers a region event; `request` edits a submitted one. */
export function EventRequestForm({
  request,
  onClose,
  onSaved,
}: {
  request?: EventRequest;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { roles, profile } = useAuth();
  const qc = useQueryClient();
  const submitFn = useServerFn(submitEventRequest),
    updateFn = useServerFn(updateEventRequest);
  const [f, setF] = useState<RequestFormFields>(() =>
    request ? requestFormFromRow(request) : emptyRequestForm(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  // End follows Start + 2 hours until the user edits End (same as the event form).
  const endTouched = useRef(!!request),
    altEndTouched = useRef(!!request?.alt_end);
  const set = <K extends keyof RequestFormFields>(key: K, value: RequestFormFields[K]) =>
    setF((cur) => ({ ...cur, [key]: value }));
  const regionRequest = request ? request.scope === "region" : roles.includes("branch_manager");

  function setStart(alt: boolean, value: string) {
    setF((cur) => {
      const next = { ...cur, [alt ? "altStart" : "start"]: value };
      if ((alt ? altEndTouched : endTouched).current || value.length !== 16) return next;
      try {
        next[alt ? "altEnd" : "end"] = londonInput(
          new Date(Date.parse(londonToIso(value)) + 2 * 3600 * 1000),
        );
      } catch {
        /* reported on submit */
      }
      return next;
    });
  }
  function setEnd(alt: boolean, value: string) {
    (alt ? altEndTouched : endTouched).current = true;
    set(alt ? "altEnd" : "end", value);
  }

  async function submit() {
    if (busy) return;
    const validation = validateRequestForm(f);
    // A date without a time (or a time without a date) is incomplete.
    if (!f.allDay)
      for (const [key, value] of [
        ["start", f.start],
        ["end", f.end],
        ...(f.hasAlt
          ? [
              ["alt-start", f.altStart],
              ["alt-end", f.altEnd],
            ]
          : []),
      ] as const)
        if (value && value.length !== 16) validation[key] = "events.fieldRequired";
    setErrors(validation);
    const first = ORDER.find((key) => validation[key]);
    if (first) {
      const value =
        first === "start"
          ? f.start
          : first === "end"
            ? f.end
            : first === "alt-start"
              ? f.altStart
              : first === "alt-end"
                ? f.altEnd
                : null;
      const target = value === null ? first : `${first}-${value.slice(0, 10) ? "time" : "date"}`;
      requestAnimationFrame(() => {
        const node = formRef.current?.querySelector<HTMLElement>(`[data-testid="${P}-${target}"]`);
        node?.scrollIntoView({ behavior: "smooth", block: "center" });
        node?.focus();
      });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = requestPayload(f);
      let id = request?.id ?? null;
      if (id) await updateFn({ data: { id, request: payload } });
      else id = await submitFn({ data: payload });
      await Promise.all(
        [
          "my-event-requests",
          "event-request",
          "managed-event-requests",
          "pending-event-requests",
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
      toast.success(t(request ? "requests.updated" : "requests.submitted"));
      onSaved(id);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`${P}-${key}-error`} role="alert" className="text-sm text-destructive">
        {t(errors[key])}
      </p>
    ) : null;
  const describe = (key: string) =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${P}-${key}-error` } : {};
  /** Timed value: date input + quarter-hour list; `value` is London "YYYY-MM-DDTHH:mm" (or a partial). */
  function dateTime(
    key: "start" | "end" | "alt-start" | "alt-end",
    label: string,
    value: string,
    onChange: (v: string) => void,
    required: boolean,
  ) {
    const day = value.slice(0, 10),
      time = value.slice(11, 16);
    const combine = (d: string, tm: string) =>
      d && tm ? `${d}T${tm}` : d ? `${d}T` : tm ? `T${tm}` : "";
    return (
      <fieldset className="min-w-0 space-y-1.5" disabled={busy}>
        <legend className="mb-1.5 text-sm font-medium leading-none">
          {label}
          {required && " *"}
        </legend>
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
          <Input
            id={`${P}-${key}-date`}
            data-testid={`${P}-${key}-date`}
            type="date"
            aria-label={`${label} – ${t("requests.dateLabel")}`}
            aria-required={required}
            {...describe(key)}
            value={day}
            onChange={(e) => onChange(combine(e.target.value, time))}
            className="h-11 min-w-0"
          />
          <TimeSelect
            id={`${P}-${key}-time`}
            testId={`${P}-${key}-time`}
            label={`${label} – ${t("requests.timeLabel")}`}
            placeholder={t("events.timePlaceholder")}
            value={time}
            onChange={(tm) => onChange(combine(day, tm))}
            disabled={busy}
            invalid={!!errors[key]}
            describedBy={errors[key] ? `${P}-${key}-error` : undefined}
          />
        </div>
        {fieldError(key)}
      </fieldset>
    );
  }
  function dateField(
    key: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    required: boolean,
  ) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${P}-${key}`}>
          {label}
          {required && " *"}
        </Label>
        <Input
          id={`${P}-${key}`}
          data-testid={`${P}-${key}`}
          type="date"
          aria-required={required}
          {...describe(key)}
          value={value}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 min-w-0"
        />
        {fieldError(key)}
      </div>
    );
  }
  const dates = (alt: boolean) =>
    f.allDay ? (
      <>
        {dateField(
          alt ? "alt-start-date" : "start-date",
          t("events.startDate"),
          alt ? f.altStartDate : f.startDate,
          (v) => set(alt ? "altStartDate" : "startDate", v),
          !alt,
        )}
        {dateField(
          alt ? "alt-end-date" : "end-date",
          t("events.endDate"),
          alt ? f.altEndDate : f.endDate,
          (v) => set(alt ? "altEndDate" : "endDate", v),
          false,
        )}
      </>
    ) : (
      <>
        {dateTime(
          alt ? "alt-start" : "start",
          t("events.start"),
          alt ? f.altStart : f.start,
          (v) => setStart(alt, v),
          !alt,
        )}
        {dateTime(
          alt ? "alt-end" : "end",
          t("events.end"),
          alt ? f.altEnd : f.end,
          (v) => setEnd(alt, v),
          !alt,
        )}
      </>
    );

  return (
    <EventDialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={request ? t("requests.editTitle") : t("requests.formTitle")}
    >
      <form
        ref={formRef}
        noValidate
        data-testid={P}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p
          data-testid={`${P}-scope`}
          data-scope={regionRequest ? "region" : "branch"}
          className="text-sm font-medium"
        >
          {regionRequest
            ? t("requests.scopeRegion", {
                region: request?.region_name ?? profile?.branches?.regions?.name ?? "",
              })
            : t("requests.scopeBranch", {
                branch: request?.branch_name ?? profile?.branches?.name ?? "",
              })}
        </p>
        <p className="text-sm text-muted-foreground">{t("requests.requiredNote")}</p>
        <div className="space-y-1.5">
          <Label htmlFor={`${P}-title`}>{t("requests.titleLabel")} *</Label>
          <Input
            id={`${P}-title`}
            data-testid={`${P}-title`}
            value={f.title}
            maxLength={REQUEST_TITLE_MAX}
            aria-required
            {...describe("title")}
            disabled={busy}
            onChange={(e) => set("title", e.target.value)}
            className="h-11"
          />
          {fieldError("title")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${P}-description`}>{t("requests.description")}</Label>
          <Textarea
            id={`${P}-description`}
            data-testid={`${P}-description`}
            value={f.description}
            maxLength={REQUEST_DESCRIPTION_MAX}
            rows={3}
            disabled={busy}
            onChange={(e) => set("description", e.target.value)}
          />
          {fieldError("description")}
        </div>
        <section className="space-y-3 border-t pt-4">
          <h3 className="font-semibold">{t("requests.proposed")}</h3>
          <div className="flex min-h-11 items-center gap-3">
            <Switch
              id={`${P}-all-day`}
              data-testid={`${P}-all-day`}
              checked={f.allDay}
              disabled={busy}
              onCheckedChange={(v) => {
                set("allDay", v);
                setErrors({});
              }}
            />
            <Label htmlFor={`${P}-all-day`}>{t("events.allDay")}</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">{dates(false)}</div>
          {f.hasAlt ? (
            <div data-testid={`${P}-alternative`} className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{t("requests.alternative")}</h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid={`${P}-remove-alternative`}
                  disabled={busy}
                  onClick={() =>
                    setF((cur) => ({
                      ...cur,
                      hasAlt: false,
                      altStart: "",
                      altEnd: "",
                      altStartDate: "",
                      altEndDate: "",
                    }))
                  }
                >
                  <X />
                  {t("requests.removeAlternative")}
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">{dates(true)}</div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              data-testid={`${P}-add-alternative`}
              disabled={busy}
              onClick={() => set("hasAlt", true)}
            >
              <Plus />
              {t("requests.addAlternative")}
            </Button>
          )}
        </section>
        <section className="space-y-3 border-t pt-4">
          <div className="flex min-h-11 items-center gap-3">
            <Switch
              id={`${P}-online`}
              data-testid={`${P}-online`}
              checked={f.isOnline}
              disabled={busy}
              onCheckedChange={(v) => set("isOnline", v)}
            />
            <Label htmlFor={`${P}-online`}>{t("requests.online")}</Label>
          </div>
          {f.isOnline ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${P}-online-url`}>{t("requests.onlineUrl")}</Label>
              <Input
                id={`${P}-online-url`}
                data-testid={`${P}-online-url`}
                type="url"
                value={f.onlineUrl}
                maxLength={2000}
                {...describe("online-url")}
                disabled={busy}
                onChange={(e) => set("onlineUrl", e.target.value)}
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">{t("requests.onlineUrlHint")}</p>
              {fieldError("online-url")}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={`${P}-location`}>{t("requests.location")}</Label>
              <Input
                id={`${P}-location`}
                data-testid={`${P}-location`}
                value={f.location}
                maxLength={500}
                {...describe("location")}
                disabled={busy}
                onChange={(e) => set("location", e.target.value)}
                className="h-11"
              />
              {fieldError("location")}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${P}-expected-attendees`}>{t("requests.expectedAttendees")}</Label>
            <Input
              id={`${P}-expected-attendees`}
              data-testid={`${P}-expected-attendees`}
              type="number"
              min={1}
              step={1}
              value={f.expectedAttendees}
              {...describe("expected-attendees")}
              disabled={busy}
              onChange={(e) => set("expectedAttendees", e.target.value)}
              className="h-11 sm:w-48"
            />
            {fieldError("expected-attendees")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${P}-reason`}>{t("requests.reason")}</Label>
            <Textarea
              id={`${P}-reason`}
              data-testid={`${P}-reason`}
              value={f.reason}
              maxLength={REQUEST_REASON_MAX}
              rows={3}
              disabled={busy}
              onChange={(e) => set("reason", e.target.value)}
            />
            {fieldError("reason")}
          </div>
        </section>
        {error && (
          <p data-testid={`${P}-error`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button data-testid={`${P}-submit`} type="submit" disabled={busy}>
            {busy ? t("common.saving") : request ? t("requests.saveChanges") : t("requests.submit")}
          </Button>
        </div>
      </form>
    </EventDialog>
  );
}
