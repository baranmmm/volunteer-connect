import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Download, UserCheck } from "lucide-react";
import { listAttendees, setAttendeeCheckIn } from "@/lib/event-managers.functions";
import { attendeeCounts, attendeesCsv, type Attendee } from "@/lib/attendees";
import { eventStart, londonToIso, type HubEvent } from "@/lib/event-rules";
import { formatDate, translateError } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

const FILTERS = ["active", "waitlisted", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];
const seated = (s: Attendee["status"]) => s === "registered" || s === "attended" || s === "no_show";
const inFilter = (a: Attendee, f: Filter) => (f === "active" ? seated(a.status) : a.status === f);

/**
 * Attendee list for the event's scope managers (BM / RD): members and guests together, check-in once the event has
 * started, CSV export. National Coordinators never get this list (counts only, in the registration panel).
 */
export function AttendeeList({ event, now }: { event: HubEvent; now: Date }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fetch = useServerFn(listAttendees),
    checkIn = useServerFn(setAttendeeCheckIn);
  const key = ["attendees", event.id];
  const list = useQuery({
    queryKey: key,
    queryFn: () => fetch({ data: { eventId: event.id } }),
    staleTime: 30000,
  });
  const [filter, setFilter] = useState<Filter>("active"),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const start = eventStart(event);
  const started =
    !!start &&
    (event.all_day ? Date.parse(londonToIso(`${start}T00:00`)) : Date.parse(start)) <=
      now.getTime();
  const all = list.data ?? [];
  const rows = all.filter((a) => inFilter(a, filter));
  const counts = attendeeCounts(all);
  async function toggle(a: Attendee, attended: boolean) {
    setBusy(a.registration_id);
    setError("");
    try {
      await checkIn({
        data: { registrationId: a.registration_id, status: attended ? "attended" : "registered" },
      });
      await Promise.all(
        [key, ["registration-summary", event.id], ["registrations", event.id]].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(null);
    }
  }
  function exportCsv() {
    const blob = new Blob([attendeesCsv(all)], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = href;
    a.download = `attendees-${event.id}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  return (
    <section
      data-testid="attendees"
      aria-labelledby="attendees-title"
      className="space-y-4 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="attendees-title" className="text-lg font-semibold">
            {t("attendees.title")}
          </h2>
          <p data-testid="attendees-counts" className="text-sm text-muted-foreground">
            {t("attendees.counts", { seats: counts.seats, waitlisted: counts.waitlisted })}
          </p>
        </div>
        <Button
          data-testid="attendees-export-csv"
          variant="outline"
          size="sm"
          disabled={!all.length}
          onClick={exportCsv}
        >
          <Download />
          {t("attendees.exportCsv")}
        </Button>
      </div>
      <div role="group" aria-label={t("attendees.filter")} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            data-testid={`attendees-filter-${f}`}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`attendees.filters.${f}`)} ({all.filter((a) => inFilter(a, f)).length})
          </Button>
        ))}
      </div>
      {list.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : list.isError ? (
        <p role="alert" className="text-destructive">
          {translateError(list.error)}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="attendees-empty" className="text-sm text-muted-foreground">
          {t("attendees.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid="attendees-table" className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">{t("attendees.columns.name")}</th>
                <th className="py-2 pr-3 font-medium">{t("attendees.columns.type")}</th>
                <th className="py-2 pr-3 font-medium">{t("attendees.columns.email")}</th>
                <th className="py-2 pr-3 font-medium">{t("attendees.columns.phone")}</th>
                <th className="py-2 pr-3 font-medium">{t("attendees.columns.places")}</th>
                <th className="py-2 pr-3 font-medium">{t("attendees.columns.status")}</th>
                <th className="py-2 font-medium">{t("attendees.columns.checkedIn")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((a) => (
                <tr
                  key={a.registration_id}
                  data-testid="attendees-row"
                  data-registration-id={a.registration_id}
                  data-kind={a.kind}
                  data-status={a.status}
                >
                  <td className="py-2 pr-3 break-words font-medium">
                    {a.full_name || t("registrations.anonymised")}
                    {a.waitlist_position ? (
                      <span className="ml-2 text-muted-foreground">#{a.waitlist_position}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant={a.kind === "guest" ? "outline" : "secondary"}>
                      {t(`attendees.kind.${a.kind}`)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 break-all">{a.email ?? ""}</td>
                  <td className="py-2 pr-3 break-all">{a.phone ?? ""}</td>
                  <td className="py-2 pr-3" data-testid="attendees-row-places">
                    {a.places}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant="secondary" data-testid="attendees-row-status">
                      {t(`registrations.status.${a.status}`)}
                    </Badge>
                  </td>
                  <td className="py-2">
                    {started && seated(a.status) ? (
                      <label className="flex min-h-11 items-center gap-2">
                        <Checkbox
                          data-testid="attendees-row-check-in"
                          checked={a.status === "attended"}
                          disabled={busy === a.registration_id}
                          aria-label={t("attendees.checkIn", { name: a.full_name ?? "" })}
                          onCheckedChange={(v) => void toggle(a, v === true)}
                        />
                        {a.status === "attended" && a.checked_in_at && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <UserCheck className="size-3.5" aria-hidden />
                            {formatDate(a.checked_in_at, { timeStyle: "short" })}
                          </span>
                        )}
                      </label>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {seated(a.status) ? t("attendees.checkInAfterStart") : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && (
        <p data-testid="attendees-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
