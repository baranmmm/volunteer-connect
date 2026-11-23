import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ExternalLink, Pencil, Trash2, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { eventWhen } from "@/lib/event-rules";
import { requestTime, type EventRequest } from "@/lib/event-requests";
import {
  deleteEventRequest,
  myEventRequests,
  withdrawEventRequest,
} from "@/lib/event-requests.functions";
import { dateLocale, formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { EventDialog } from "@/components/events/EventDialog";
import { RequestStatusBadge } from "./RequestStatusBadge";
import { RequestTypeBadge } from "./RequestParts";
import { matchesFilter, type RequestListFilter } from "./request-kinds";
import { EventRequestForm } from "./EventRequestForm";

/** Proposed (and alternative) dates of a request in London time. */
export function RequestWhen({ request }: { request: EventRequest }) {
  const { t } = useTranslation();
  const main = eventWhen(requestTime(request), dateLocale()),
    alt = eventWhen(requestTime(request, true), dateLocale());
  return (
    <>
      <p className="text-sm">
        {main
          ? `${main.text}${main.allDay ? ` · ${t("events.allDay")}` : ""}`
          : t("events.unscheduled")}
      </p>
      {alt && (
        <p className="text-sm text-muted-foreground">
          {t("requests.alternative")}: {alt.text}
          {alt.allDay ? ` · ${t("events.allDay")}` : ""}
        </p>
      )}
    </>
  );
}

/** The viewer's event requests (Event · External / Event · Proposal), narrowed by the page's filter. */
export function MyEventRequests({ filter = "all" }: { filter?: RequestListFilter }) {
  const { t } = useTranslation();
  const { session, profile } = useAuth();
  const fetch = useServerFn(myEventRequests),
    withdraw = useServerFn(withdrawEventRequest),
    remove = useServerFn(deleteEventRequest),
    qc = useQueryClient();
  const query = useQuery({
    queryKey: ["my-event-requests", session?.user.id],
    queryFn: () => fetch(),
    enabled: profile?.status === "active",
    staleTime: 30000,
  });
  const [editing, setEditing] = useState<EventRequest | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: "withdraw" | "delete";
    request: EventRequest;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function act() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      if (confirm.kind === "withdraw") await withdraw({ data: { id: confirm.request.id } });
      else await remove({ data: { id: confirm.request.id } });
      await Promise.all(
        [
          "my-event-requests",
          "managed-event-requests",
          "pending-event-requests",
          "recycle-bin",
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
      toast.success(
        t(confirm.kind === "withdraw" ? "requests.withdrawnToast" : "requests.deletedToast"),
      );
      setConfirm(null);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  const rows = (query.data ?? []).filter((r) => matchesFilter(r.status, filter));
  return (
    <section aria-label={t("requests.kinds.event")} className="space-y-3">
      {query.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : query.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-destructive">{t("requests.loadError")}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <ul data-testid="my-requests-list" className="space-y-3">
          {rows.length === 0 && (
            <li
              data-testid="my-requests-empty"
              className="border-y py-10 text-center text-muted-foreground"
            >
              {t("requests.empty")}
            </li>
          )}
          {rows.map((r) => (
            <li
              key={r.id}
              data-testid={`my-request-row-${r.id}`}
              data-request-id={r.id}
              data-status={r.status}
              className="space-y-2 rounded-lg border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 break-words font-semibold">{r.title}</h3>
                <span className="flex flex-wrap gap-2">
                  <RequestTypeBadge
                    type={r.request_type}
                    kind="event"
                    testId={`request-type-badge-${r.id}`}
                  />
                  <RequestStatusBadge status={r.status} testId={`my-request-status-${r.id}`} />
                </span>
              </div>
              {r.edited_by_manager && (
                <p
                  data-testid={`my-request-edited-${r.id}`}
                  className="text-xs text-muted-foreground"
                >
                  {t("requests.editedByManager")}
                </p>
              )}
              <RequestWhen request={r} />
              <p className="text-xs text-muted-foreground">
                {t("requests.submittedOn", {
                  date: formatDate(r.created_at, { dateStyle: "medium" }),
                })}
              </p>
              {r.status === "declined" && r.decline_reason && (
                <p
                  data-testid={`my-request-decline-reason-${r.id}`}
                  className="break-words rounded-md bg-status-cancelled-bg p-2 text-sm"
                >
                  {t("requests.declinedBecause", { reason: r.decline_reason })}
                </p>
              )}
              {r.status === "approved" && (
                <p className="text-sm text-muted-foreground">
                  {t("requests.approvedDraft")}{" "}
                  {r.event_id && (
                    <Link
                      to="/events/$id"
                      params={{ id: r.event_id }}
                      data-testid={`my-request-event-link-${r.id}`}
                      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t("requests.viewEvent")}
                      <ExternalLink className="size-3.5" aria-hidden />
                    </Link>
                  )}
                </p>
              )}
              {(r.can_edit || r.can_withdraw || r.can_delete) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {r.can_edit && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`my-request-edit-${r.id}`}
                      onClick={() => setEditing(r)}
                    >
                      <Pencil />
                      {t("requests.edit")}
                    </Button>
                  )}
                  {r.can_withdraw && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`my-request-withdraw-${r.id}`}
                      onClick={() => {
                        setError("");
                        setConfirm({ kind: "withdraw", request: r });
                      }}
                    >
                      <Undo2 />
                      {t("requests.withdraw")}
                    </Button>
                  )}
                  {r.can_delete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`my-request-delete-${r.id}`}
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setError("");
                        setConfirm({ kind: "delete", request: r });
                      }}
                    >
                      <Trash2 />
                      {t("requests.delete")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <EventRequestForm
          request={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
      <EventDialog
        open={confirm !== null}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        title={confirm?.kind === "delete" ? t("requests.deleteTitle") : t("requests.withdrawTitle")}
      >
        <p className="text-muted-foreground">
          {confirm?.kind === "delete"
            ? t("requests.deleteText", { title: confirm.request.title })
            : t("requests.withdrawText", { title: confirm?.request.title ?? "" })}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="my-request-confirm"
            variant="destructive"
            disabled={busy}
            onClick={() => void act()}
          >
            {busy
              ? t("common.saving")
              : confirm?.kind === "delete"
                ? t("requests.deleteConfirm")
                : t("requests.withdrawConfirm")}
          </Button>
        </div>
      </EventDialog>
    </section>
  );
}
