import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Ban, CircleCheck, MapPin, Pencil, Search, Trash2, Users, Video } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DECLINE_REASON_MIN, type EventRequest, type ManagerTab } from "@/lib/event-requests";
import {
  approveEventRequest,
  eventRequestDuplicates,
  declineEventRequest,
  deleteEventRequest,
  getEventRequest,
  managedEventRequests,
  startReviewEventRequest,
} from "@/lib/event-requests.functions";
import { formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EventDialog } from "@/components/events/EventDialog";
import { RequestStatusBadge } from "./RequestStatusBadge";
import { RequestWhen } from "./MyEventRequests";
import { RequestAttachments, RequestTypeBadge } from "./RequestParts";
import { EventRequestForm } from "./EventRequestForm";

const REFRESH = [
  "managed-event-requests",
  "pending-event-requests",
  "event-request",
  "events",
  "recycle-bin",
];

/** Reviewers (branch managers for their branch, regional directors for their region) work through requests here. */
export function ManagerEventRequests({ group = "review" }: { group?: "review" | "decided" }) {
  const { t } = useTranslation();
  const { session, profile } = useAuth();
  const list = useServerFn(managedEventRequests);
  const tabs: ManagerTab[] = group === "decided" ? ["decided"] : ["submitted", "under_review"];
  const [pages, setPages] = useState(1),
    [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["managed-event-requests", session?.user.id, group, pages],
    queryFn: async () => {
      const rows: EventRequest[] = [];
      let total = 0;
      for (const tab of tabs) {
        for (let page = 0; page < pages; page++) {
          const result = await list({ data: { tab, offset: page * 50 } });
          rows.push(...result.rows);
          if (page === 0) total += result.total;
          if (result.rows.length < 50) break;
        }
      }
      return { rows, total };
    },
    enabled: profile?.status === "active",
    staleTime: 15000,
  });
  const rows = query.data?.rows ?? [];
  return (
    <section
      data-testid="manager-requests-page"
      aria-label={t(group === "review" ? "requests.toReview" : "requests.tabs.decided")}
      className="space-y-4"
    >
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
        <div>
          <ul data-testid="manager-requests-list" className="space-y-3">
            {rows.length === 0 && (
              <li className="border-y py-10 text-center text-muted-foreground">
                {t("requests.emptyTab")}
              </li>
            )}
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  data-testid={`manager-request-row-${r.id}`}
                  data-request-id={r.id}
                  data-status={r.status}
                  onClick={() => setOpen(r.id)}
                  className={cn(
                    "block w-full space-y-1.5 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring",
                    r.status === "submitted" && "border-dashed border-status-draft-border",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 break-words font-semibold">{r.title}</span>
                    <span className="flex flex-wrap gap-2">
                      <RequestTypeBadge
                        type={r.request_type}
                        testId={`request-type-badge-${r.id}`}
                      />
                      <RequestStatusBadge status={r.status} />
                    </span>
                  </div>
                  <RequestWhen request={r} />
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {r.scope === "region" ? r.region_name : r.branch_name} ·{" "}
                    {t("requests.requestedBy", {
                      name: r.requester_name ?? t("common.formerMember"),
                    })}{" "}
                    · {formatDate(r.created_at, { dateStyle: "medium" })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {query.data && rows.length < query.data.total && (
        <Button
          variant="outline"
          data-testid="manager-requests-load-more"
          onClick={() => setPages((n) => n + 1)}
        >
          {t("requests.loadMore")}
        </Button>
      )}
      {open && <RequestReview id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function RequestReview({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const fetch = useServerFn(getEventRequest),
    start = useServerFn(startReviewEventRequest),
    approve = useServerFn(approveEventRequest),
    decline = useServerFn(declineEventRequest),
    remove = useServerFn(deleteEventRequest);
  const qc = useQueryClient(),
    navigate = useNavigate();
  const query = useQuery({
    queryKey: ["event-request", id, session?.user.id],
    queryFn: () => fetch({ data: { id } }),
    staleTime: 0,
  });
  const duplicatesFn = useServerFn(eventRequestDuplicates);
  const duplicates = useQuery({
    queryKey: ["event-request-duplicates", id, session?.user.id],
    queryFn: () => duplicatesFn({ data: { id } }),
    enabled: !!query.data?.can_review,
    staleTime: 0,
  });
  const [editing, setEditing] = useState(false);
  // External requests are published on approval: the reviewer chooses who sees the event (members by default).
  const [audience, setAudience] = useState<"members" | "public">("members");
  const [declining, setDeclining] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await Promise.all(REFRESH.map((key) => qc.invalidateQueries({ queryKey: [key] })));
      toast.success(t(success));
      return true;
    } catch (e) {
      setError(translateError(e));
      await qc.invalidateQueries({ queryKey: ["event-request", id] });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const r = query.data;
  return (
    <EventDialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t("requests.details")}
      testId="manager-request-detail"
    >
      {query.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : query.isError || !r ? (
        <p role="alert" className="text-destructive">
          {translateError(query.error)}
        </p>
      ) : (
        <div className="space-y-4" data-request-id={r.id} data-status={r.status}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3
              data-testid="manager-request-title"
              className="min-w-0 break-words text-lg font-semibold"
            >
              {r.title}
            </h3>
            <div className="flex flex-wrap gap-2">
              <RequestTypeBadge type={r.request_type} testId={`request-type-badge-${r.id}`} />
              <RequestStatusBadge status={r.status} testId="manager-request-status" />
            </div>
          </div>
          {r.can_review && (duplicates.data?.length ?? 0) > 0 && (
            <div
              data-testid="manager-request-duplicate-warning"
              role="status"
              className="rounded-md border border-status-live bg-status-live-bg p-3 text-sm"
            >
              <p className="font-medium">{t("requests.duplicateWarning")}</p>
              <ul className="mt-1 list-disc pl-5">
                {duplicates.data?.map((d) => (
                  <li key={d.id} data-event-id={d.id}>
                    <a
                      href={`/events/${d.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {d.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("events.scope")}</dt>
              <dd className="[overflow-wrap:anywhere]">
                {r.scope === "region"
                  ? `${t("events.region")}: ${r.region_name ?? ""}`
                  : `${t("events.branch")}: ${r.branch_name ?? ""}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("requests.proposed")}</dt>
              <dd>
                <RequestWhen request={r} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("requests.requester")}</dt>
              <dd>
                {r.requester_name ?? t("common.formerMember")} ·{" "}
                {formatDate(r.created_at, { dateStyle: "medium" })}
              </dd>
            </div>
            {r.request_type === "external" && (
              <div>
                <dt className="text-muted-foreground">{t("requests.organizer")}</dt>
                <dd data-testid="manager-request-organizer">{r.organizer_name}</dd>
              </div>
            )}
            {r.source && (
              <div>
                <dt className="text-muted-foreground">{t("requests.source")}</dt>
                <dd>
                  {t(`requests.sources.${r.source}`)}
                  {r.source_url && (
                    <>
                      {" · "}
                      <a
                        data-testid="manager-request-source-url"
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-primary underline-offset-4 hover:underline"
                      >
                        {t("requests.sourceUrl")}
                      </a>
                    </>
                  )}
                </dd>
              </div>
            )}
            {r.category && (
              <div>
                <dt className="text-muted-foreground">{t("events.category")}</dt>
                <dd>{t(`events.categories.${r.category}`)}</dd>
              </div>
            )}
            {r.expected_attendees && (
              <div>
                <dt className="sr-only">{t("requests.expectedAttendees")}</dt>
                <dd className="flex items-center gap-1">
                  <Users className="size-4" aria-hidden />
                  {t("requests.expected", { count: r.expected_attendees })}
                </dd>
              </div>
            )}
          </dl>
          {(r.location_text || r.is_online) && (
            <p className="flex items-start gap-2 text-sm">
              {r.is_online ? (
                <Video className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span className="break-all">
                {r.is_online ? (r.online_url ?? t("events.online")) : r.location_text}
              </span>
            </p>
          )}
          {r.description && (
            <p className="whitespace-pre-wrap break-words text-sm">{r.description}</p>
          )}
          {r.reason && (
            <div className="text-sm">
              <p className="font-medium">{t("requests.reason")}</p>
              <p className="whitespace-pre-wrap break-words text-muted-foreground">{r.reason}</p>
            </div>
          )}
          {r.notes && (
            <div className="text-sm">
              <p className="font-medium">{t("requests.notes")}</p>
              <p className="whitespace-pre-wrap break-words text-muted-foreground">{r.notes}</p>
            </div>
          )}
          <RequestAttachments requestId={r.id} testId="manager-request-attachments" />
          {r.edited_by_manager && r.last_edited_by_name && (
            <p className="text-xs text-muted-foreground">
              {t("requests.editedBy", { name: r.last_edited_by_name })}
            </p>
          )}
          {r.decline_reason && (
            <p className="break-words rounded-md bg-status-cancelled-bg p-2 text-sm">
              {t("requests.declinedBecause", { reason: r.decline_reason })}
            </p>
          )}
          {r.reviewer_name && r.status !== "submitted" && (
            <p className="text-xs text-muted-foreground">
              {t("requests.reviewedBy", { name: r.reviewer_name })}
            </p>
          )}
          {declining && (
            <div className="space-y-1.5">
              <Label htmlFor="manager-request-decline-reason">
                {t("requests.declineReason")} *
              </Label>
              <Textarea
                id="manager-request-decline-reason"
                data-testid="manager-request-decline-reason"
                value={reason}
                maxLength={1000}
                rows={3}
                disabled={busy}
                aria-describedby="manager-request-decline-hint"
                onChange={(e) => setReason(e.target.value)}
              />
              <p id="manager-request-decline-hint" className="text-xs text-muted-foreground">
                {t("requests.declineHint")}
              </p>
            </div>
          )}
          {error && (
            <p
              data-testid="manager-request-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
            {r.can_delete && !declining && (
              <Button
                variant="ghost"
                data-testid="manager-request-delete"
                className="text-destructive hover:text-destructive sm:mr-auto"
                disabled={busy}
                onClick={() =>
                  void run(() => remove({ data: { id } }), "requests.deletedToast").then(
                    (ok) => ok && onClose(),
                  )
                }
              >
                <Trash2 />
                {t("requests.delete")}
              </Button>
            )}
            {r.can_review && !declining && (
              <Button
                variant="outline"
                data-testid="manager-request-edit"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                <Pencil />
                {t("requests.editRequest")}
              </Button>
            )}
            {r.can_review && !declining && r.status === "submitted" && (
              <Button
                variant="outline"
                data-testid="manager-request-start-review"
                disabled={busy}
                onClick={() => void run(() => start({ data: { id } }), "requests.reviewStarted")}
              >
                <Search />
                {t("requests.startReview")}
              </Button>
            )}
            {r.can_review &&
              (declining ? (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setDeclining(false);
                      setError("");
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    data-testid="manager-request-decline-confirm"
                    disabled={busy || reason.trim().length < DECLINE_REASON_MIN}
                    onClick={() =>
                      void run(
                        () => decline({ data: { id, reason: reason.trim() } }),
                        "requests.declinedToast",
                      ).then((ok) => ok && onClose())
                    }
                  >
                    <Ban />
                    {t("requests.declineConfirm")}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    data-testid="manager-request-decline"
                    className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onClick={() => {
                      setDeclining(true);
                      setError("");
                    }}
                  >
                    <Ban />
                    {t("requests.decline")}
                  </Button>
                  {r.request_type === "external" && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="manager-request-audience" className="text-sm">
                        {t("events.visibleTo")}
                      </Label>
                      <Select
                        value={audience}
                        disabled={busy}
                        onValueChange={(v) => setAudience(v === "public" ? "public" : "members")}
                      >
                        <SelectTrigger
                          id="manager-request-audience"
                          data-testid="manager-request-audience"
                          className="h-11 w-48"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            value="members"
                            data-testid="manager-request-audience-option-members"
                          >
                            {t("events.audience.members")}
                          </SelectItem>
                          <SelectItem
                            value="public"
                            data-testid="manager-request-audience-option-public"
                          >
                            {t("events.audience.public")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button
                    data-testid={
                      r.request_type === "external"
                        ? "manager-request-approve-publish"
                        : "manager-request-approve"
                    }
                    disabled={busy}
                    onClick={async () => {
                      let approved: {
                        eventId: string;
                        published: boolean;
                        failedCopies: number;
                      } | null = null;
                      const external = r.request_type === "external";
                      if (
                        await run(
                          async () => {
                            approved = await approve({
                              data: { id, ...(external ? { audience } : {}) },
                            });
                          },
                          external ? "requests.publishedToast" : "requests.approvedToast",
                        )
                      ) {
                        const done = approved as {
                          eventId: string;
                          published: boolean;
                          failedCopies: number;
                        } | null;
                        if (!done) return;
                        if (done.failedCopies)
                          toast.error(t("requests.copyFailed", { count: done.failedCopies }));
                        // External events are published as they are; drafts open in the edit form.
                        await navigate({
                          to: "/events/$id",
                          params: { id: done.eventId },
                          search: done.published ? {} : { edit: true },
                        });
                      }
                    }}
                  >
                    <CircleCheck />
                    {r.request_type === "external"
                      ? t("requests.approvePublish")
                      : t("requests.approve")}
                  </Button>
                </>
              ))}
          </div>
        </div>
      )}
      {editing && r && (
        <EventRequestForm
          request={r}
          mode="manager"
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void Promise.all(REFRESH.map((key) => qc.invalidateQueries({ queryKey: [key] })));
            void qc.invalidateQueries({ queryKey: ["event-request-duplicates", id] });
            void qc.invalidateQueries({ queryKey: ["event-request-media", id] });
          }}
        />
      )}
    </EventDialog>
  );
}
