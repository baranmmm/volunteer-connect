import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Download, UserCheck, UserX, Users } from "lucide-react";
import {
  cancelRegistration,
  getRegistrationSummary,
  listRegistrations,
  markAttendance,
  registerForEvent,
  setRegistrationShowName,
} from "@/lib/registrations.functions";
import {
  registrationAction,
  registrationCountText,
  registrationsCsv,
  type ManagerRegistration,
  type RegistrationStatus,
} from "@/lib/registrations";
import { eventStart, londonToIso, type HubEvent } from "@/lib/event-rules";
import { formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const summaryKey = (id: string) => ["registration-summary", id];
const listKey = (id: string) => ["registrations", id];

function useInvalidate(eventId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [summaryKey(eventId), listKey(eventId), ["events"], ["my-registrations"]].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
}

/** Volunteer view: count, Register / Join waitlist / Cancel, waitlist position, "show my name", names shown by others. */
export function RegistrationPanel({ event, now }: { event: HubEvent; now: Date }) {
  const { t } = useTranslation();
  const fetch = useServerFn(getRegistrationSummary),
    register = useServerFn(registerForEvent),
    cancel = useServerFn(cancelRegistration),
    showNameFn = useServerFn(setRegistrationShowName);
  const summary = useQuery({
    queryKey: summaryKey(event.id),
    queryFn: () => fetch({ data: { eventId: event.id } }),
    enabled: event.status !== "draft",
    staleTime: 30000,
  });
  const invalidate = useInvalidate(event.id);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showName, setShowName] = useState<boolean | null>(null);
  if (event.status === "draft") return null;
  if (summary.isLoading)
    return (
      <section data-testid="event-registration" className="border-t pt-5">
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </section>
    );
  if (summary.isError || !summary.data)
    return (
      <section data-testid="event-registration" className="border-t pt-5">
        <p role="alert" className="text-destructive">
          {t("registrations.loadError")}
        </p>
      </section>
    );
  const s = summary.data;
  const action = registrationAction(event, s, now);
  const active = s.my_status === "registered" || s.my_status === "waitlisted";
  const nameChoice = showName ?? s.my_show_name;
  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await invalidate();
      toast.success(success);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggleName(next: boolean) {
    setShowName(next);
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      await showNameFn({ data: { eventId: event.id, showName: next } });
      await invalidate();
    } catch (e) {
      setShowName(!next);
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      data-testid="event-registration"
      aria-labelledby="event-registration-title"
      className="space-y-4 border-t pt-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="event-registration-title" className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-5 text-primary" aria-hidden />
          {t("registrations.title")}
        </h2>
        <span data-testid="event-registration-count" className="text-muted-foreground">
          {registrationCountText(s, t)}
        </span>
      </div>
      {s.my_status && s.my_status !== "cancelled" && (
        <p
          data-testid="event-registration-status"
          data-status={s.my_status}
          className="flex items-center gap-2 font-medium"
        >
          {s.my_status === "waitlisted" ? (
            <span data-testid="event-waitlist-position">
              {t("registrations.waitlistPosition", { position: s.my_waitlist_position ?? 0 })}
            </span>
          ) : (
            <>
              <Check className="size-4 text-status-published" aria-hidden />
              {t(`registrations.myStatus.${s.my_status}`)}
            </>
          )}
        </p>
      )}
      {action.kind === "none" ? (
        <p
          data-testid="event-registration-unavailable"
          data-reason={action.reason}
          className="text-sm text-muted-foreground"
        >
          {t(`registrations.unavailable.${action.reason}`)}
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {action.kind === "register" && (
            <Button
              data-testid="event-register-button"
              className="h-11"
              disabled={busy}
              onClick={() =>
                void run(
                  () => register({ data: { eventId: event.id, showName: nameChoice } }),
                  t("registrations.registered"),
                )
              }
            >
              {t("registrations.register")}
            </Button>
          )}
          {action.kind === "waitlist" && (
            <Button
              data-testid="event-join-waitlist-button"
              variant="secondary"
              className="h-11"
              disabled={busy}
              onClick={() =>
                void run(
                  () => register({ data: { eventId: event.id, showName: nameChoice } }),
                  t("registrations.waitlisted"),
                )
              }
            >
              {t("registrations.joinWaitlist")}
            </Button>
          )}
          {action.kind === "cancel" && (
            <Button
              data-testid="event-cancel-registration-button"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() =>
                void run(
                  () => cancel({ data: { eventId: event.id } }),
                  t("registrations.cancelled"),
                )
              }
            >
              {t("registrations.cancel")}
            </Button>
          )}
        </div>
      )}
      {(action.kind !== "none" || active) && (
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox
            id="event-show-name"
            data-testid="event-show-name-checkbox"
            checked={nameChoice}
            disabled={busy}
            onCheckedChange={(v) => void toggleName(v === true)}
          />
          <Label htmlFor="event-show-name">{t("registrations.showName")}</Label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {s.names_visible && s.names.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("registrations.attendees")}
          </h3>
          <ul data-testid="event-attendee-list" className="flex flex-wrap gap-2">
            {s.names.map((name, i) => (
              <li key={`${i}-${name}`}>
                <Badge variant="secondary">{name}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const FILTERS = ["registered", "waitlisted", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];
const inFilter = (status: RegistrationStatus, filter: Filter) =>
  filter === "registered"
    ? ["registered", "attended", "no_show"].includes(status)
    : status === filter;

/** Manager view (BM own branch / RD own region): full list, attendance after start, CSV, capacity warning. */
export function ManagerRegistrations({ event, now }: { event: HubEvent; now: Date }) {
  const { t } = useTranslation();
  const fetch = useServerFn(listRegistrations),
    summaryFn = useServerFn(getRegistrationSummary),
    mark = useServerFn(markAttendance);
  const list = useQuery({
    queryKey: listKey(event.id),
    queryFn: () => fetch({ data: { eventId: event.id } }),
    staleTime: 30000,
  });
  const summary = useQuery({
    queryKey: summaryKey(event.id),
    queryFn: () => summaryFn({ data: { eventId: event.id } }),
    enabled: event.status !== "draft",
    staleTime: 30000,
  });
  const invalidate = useInvalidate(event.id);
  const [filter, setFilter] = useState<Filter>("registered"),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const start = eventStart(event);
  const started =
    !!start &&
    (event.all_day ? Date.parse(londonToIso(`${start}T00:00`)) : Date.parse(start)) <=
      now.getTime();
  const rows = (list.data ?? []).filter((r) => inFilter(r.status, filter));
  async function setAttendance(r: ManagerRegistration, status: "attended" | "no_show") {
    setBusy(r.id);
    setError("");
    try {
      await mark({ data: { registrationId: r.id, status } });
      await invalidate();
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(null);
    }
  }
  function exportCsv() {
    const blob = new Blob([registrationsCsv(list.data ?? [])], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = href;
    a.download = `registrations-${event.id}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  return (
    <section
      data-testid="event-manager-registrations"
      aria-labelledby="event-manager-registrations-title"
      className="space-y-4 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="event-manager-registrations-title" className="text-lg font-semibold">
          {t("registrations.managerTitle")}
        </h2>
        <Button
          data-testid="event-registrations-export-csv"
          variant="outline"
          size="sm"
          disabled={!list.data?.length}
          onClick={exportCsv}
        >
          <Download />
          {t("registrations.exportCsv")}
        </Button>
      </div>
      {summary.data?.over_capacity && (
        <p
          data-testid="event-capacity-warning"
          role="status"
          className="flex items-start gap-2 rounded-md border border-status-cancelled/40 bg-status-cancelled/10 p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("registrations.overCapacity", {
            count: summary.data.registered_count,
            capacity: summary.data.capacity ?? 0,
          })}
        </p>
      )}
      <div role="group" aria-label={t("registrations.filter")} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            data-testid={`event-registrations-filter-${f}`}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`registrations.filters.${f}`)} (
            {(list.data ?? []).filter((r) => inFilter(r.status, f)).length})
          </Button>
        ))}
      </div>
      {list.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : list.isError ? (
        <p role="alert" className="text-destructive">
          {t("registrations.loadError")}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="event-registrations-empty" className="text-sm text-muted-foreground">
          {t("registrations.empty")}
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li
              key={r.id}
              data-testid={`event-registration-row-${r.id}`}
              data-registration-id={r.id}
              data-status={r.status}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="break-words font-medium">
                  {r.full_name || t("registrations.anonymised")}
                  {r.waitlist_position ? (
                    <span className="ml-2 text-sm text-muted-foreground">
                      #{r.waitlist_position}
                    </span>
                  ) : null}
                </p>
                {r.email && <p className="break-all text-sm text-muted-foreground">{r.email}</p>}
                <p className="text-xs text-muted-foreground">
                  {t("registrations.registeredAt", {
                    date: formatDate(r.registered_at, { dateStyle: "medium", timeStyle: "short" }),
                  })}
                  {r.cancelled_at
                    ? ` · ${t("registrations.cancelledAt", { date: formatDate(r.cancelled_at, { dateStyle: "medium", timeStyle: "short" }) })}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" data-testid={`event-registration-status-${r.id}`}>
                  {t(`registrations.status.${r.status}`)}
                </Badge>
                {started && ["registered", "attended", "no_show"].includes(r.status) && (
                  <>
                    <Button
                      data-testid={`event-attendance-${r.id}-attended`}
                      size="sm"
                      variant={r.status === "attended" ? "default" : "outline"}
                      aria-pressed={r.status === "attended"}
                      disabled={busy === r.id}
                      onClick={() => void setAttendance(r, "attended")}
                    >
                      <UserCheck />
                      {t("registrations.attended")}
                    </Button>
                    <Button
                      data-testid={`event-attendance-${r.id}-no_show`}
                      size="sm"
                      variant={r.status === "no_show" ? "default" : "outline"}
                      aria-pressed={r.status === "no_show"}
                      disabled={busy === r.id}
                      onClick={() => void setAttendance(r, "no_show")}
                    >
                      <UserX />
                      {t("registrations.noShow")}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
