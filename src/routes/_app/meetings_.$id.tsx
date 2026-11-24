import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  MapPin,
  Pencil,
  Repeat,
  RotateCcw,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { pageHead } from "@/components/app/head";
import { EventDialog } from "@/components/events/EventDialog";
import { cancelledTitle } from "@/components/events/event-status-styles";
import { MeetingAgenda } from "@/components/meetings/MeetingAgenda";
import { MeetingScope } from "@/components/meetings/MeetingCard";
import { MeetingFiles } from "@/components/meetings/MeetingFiles";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import { MeetingFromLast } from "@/components/meetings/MeetingFromLast";
import {
  MeetingScopeDialog,
  type MeetingScopeAction,
} from "@/components/meetings/MeetingScopeDialog";
import { MeetingSeriesPanel } from "@/components/meetings/MeetingSeriesPanel";
import { MeetingStatusBadge } from "@/components/meetings/MeetingStatusBadge";
import { inviteesHeader, meetingWhen } from "@/components/meetings/meeting-ui";
import { useWorkScopes } from "@/components/work/use-work-scopes";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { MeetingDetail, MeetingSeriesMode, MeetingStatus } from "@/lib/meetings";
import {
  deleteMeeting,
  deleteMeetingSeries,
  getMeeting,
  listMeetings,
  setMeetingStatus,
} from "@/lib/meetings.functions";
import { useMarkNoticesRead } from "@/lib/use-work-notices";

export const Route = createFileRoute("/_app/meetings_/$id")({
  ssr: false,
  head: () =>
    pageHead(
      "Meeting",
      "A Dialogue Society meeting: agenda, decisions, files and follow-up tasks.",
    ),
  component: MeetingDetailPage,
});

function MeetingDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fetch = useServerFn(getMeeting),
    setStatus = useServerFn(setMeetingStatus),
    remove = useServerFn(deleteMeeting),
    removeSeries = useServerFn(deleteMeetingSeries),
    list = useServerFn(listMeetings);
  const query = useQuery({
    queryKey: ["meeting", id, uid],
    queryFn: () => fetch({ data: { id } }),
    enabled: !!uid,
    // Signed file links last five minutes.
    staleTime: 240000,
    refetchInterval: 240000,
  });
  // Opening the meeting marks its notices as read.
  useMarkNoticesRead([{ entityType: "meeting", entityId: id }], "meetings", !!uid);

  const [editing, setEditing] = useState(false),
    [rescheduling, setRescheduling] = useState(false),
    [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null),
    // An occurrence of a recurring meeting: cancel and delete first ask which occurrences.
    [scopeAction, setScopeAction] = useState<Exclude<MeetingScopeAction, "edit"> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    // Invitees: collapsed by default; the header shows the count and the first names.
    [inviteesOpen, setInviteesOpen] = useState(false);
  // One possible scope: every meeting the user sees comes from it, so the scope is not shown.
  const { single } = useWorkScopes();

  if (query.isLoading) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (query.isError)
    return (
      <div role="alert" className="space-y-3">
        <p className="text-destructive">{t("meetings.loadError")}</p>
        <Button variant="outline" data-testid="meeting-retry" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  const meeting = query.data;
  if (!meeting)
    return (
      <div data-testid="meeting-not-found" className="space-y-4">
        <p>{t("meetings.notFound")}</p>
        <Button asChild variant="outline">
          <Link to="/meetings" data-testid="meeting-back">
            <ArrowLeft />
            {t("meetings.back")}
          </Link>
        </Button>
      </div>
    );

  async function changeStatus(status: MeetingStatus) {
    setBusy(true);
    setError("");
    try {
      await setStatus({ data: { id, status } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["meeting", id] }),
        qc.invalidateQueries({ queryKey: ["meetings"] }),
      ]);
      toast.success(t(`meetings.statusChanged.${status}`));
      setConfirm(null);
    } catch (e) {
      setError(translateError(e));
      if (!confirm) toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmDelete() {
    setBusy(true);
    setError("");
    try {
      await remove({ data: { id } });
      qc.removeQueries({ queryKey: ["meeting", id] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["meetings"] }),
        qc.invalidateQueries({ queryKey: ["recycle-bin"] }),
      ]);
      toast.success(t("meetings.deleted"));
      setConfirm(null);
      await navigate({ to: "/meetings" });
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  /** Cancels the chosen occurrences that are still scheduled (each one notifies its invitees). */
  async function cancelOccurrences(current: MeetingDetail, mode: MeetingSeriesMode) {
    if (mode === "this") return [current.id];
    const lists = await Promise.all([
      list({ data: { when: "upcoming", limit: 500 } }),
      list({ data: { when: "past", limit: 500 } }),
    ]);
    const ids = new Set<string>();
    for (const m of lists.flat())
      if (
        m.series_id === current.series_id &&
        m.can_edit &&
        m.status === "scheduled" &&
        (mode === "all" || Date.parse(m.starts_at) >= Date.parse(current.starts_at))
      )
        ids.add(m.id);
    return [...ids];
  }
  async function confirmScope(current: MeetingDetail, mode: MeetingSeriesMode) {
    setBusy(true);
    setError("");
    try {
      if (scopeAction === "delete") {
        const { count } = await removeSeries({ data: { id, mode } });
        qc.removeQueries({ queryKey: ["meeting", id] });
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["meetings"] }),
          qc.invalidateQueries({ queryKey: ["meeting"] }),
          qc.invalidateQueries({ queryKey: ["recycle-bin"] }),
          qc.invalidateQueries({ queryKey: ["events"] }),
        ]);
        toast.success(count > 1 ? t("meetings.deletedMany", { count }) : t("meetings.deleted"));
        setScopeAction(null);
        await navigate({ to: "/meetings" });
        return;
      }
      const targets = await cancelOccurrences(current, mode);
      for (const target of targets) await setStatus({ data: { id: target, status: "cancelled" } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["meeting"] }),
        qc.invalidateQueries({ queryKey: ["meetings"] }),
        qc.invalidateQueries({ queryKey: ["events"] }),
      ]);
      toast.success(
        targets.length > 1
          ? t("meetings.cancelledMany", { count: targets.length })
          : t("meetings.statusChanged.cancelled"),
      );
      setScopeAction(null);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  const editor = meeting.can_edit;
  const series = meeting.series;
  const askCancel = () => {
    setError("");
    if (series) setScopeAction("cancel");
    else setConfirm("cancel");
  };
  const askDelete = () => {
    setError("");
    if (series) setScopeAction("delete");
    else setConfirm("delete");
  };
  return (
    <article
      data-testid="meeting-detail"
      data-meeting-id={meeting.id}
      data-status={meeting.status}
      className="min-w-0 space-y-6"
    >
      <Link
        to="/meetings"
        data-testid="meeting-back"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        {t("meetings.back")}
      </Link>
      <header className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <MeetingStatusBadge status={meeting.status} testId="meeting-status" />
          {meeting.invited && (
            <span data-testid="meeting-invited" className="text-sm text-muted-foreground">
              {t("meetings.invitedText")}
            </span>
          )}
        </div>
        <h1
          data-testid="meeting-title"
          className={`text-3xl font-bold [overflow-wrap:anywhere] sm:text-4xl ${cancelledTitle(meeting.status)}`}
        >
          {meeting.title}
        </h1>
        {series && (
          <nav
            data-testid="meeting-series-info"
            data-position={meeting.series_position ?? undefined}
            data-count={meeting.series_count ?? undefined}
            aria-label={t("meetings.series.navigation")}
            className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm"
          >
            <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
              <Repeat className="size-4 shrink-0" aria-hidden />
              {t("meetings.series.position", {
                n: meeting.series_position ?? 1,
                total: meeting.series_count ?? series.count,
              })}
              <span className="sr-only">
                {" "}
                {t(`meetings.series.every.${series.freq}`, { count: series.interval })}
              </span>
            </span>
            <span aria-hidden className="hidden text-muted-foreground sm:inline">
              {t(`meetings.series.every.${series.freq}`, { count: series.interval })}
            </span>
            <span className="flex flex-wrap gap-3">
              {series.previous_id && (
                <Link
                  to="/meetings/$id"
                  params={{ id: series.previous_id }}
                  data-testid="meeting-series-previous"
                  className="inline-flex min-h-11 items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                  {t("meetings.series.previous")}
                </Link>
              )}
              {series.next_id && (
                <Link
                  to="/meetings/$id"
                  params={{ id: series.next_id }}
                  data-testid="meeting-series-next"
                  className="inline-flex min-h-11 items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  {t("meetings.series.next")}
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
              )}
            </span>
          </nav>
        )}
      </header>
      <div className="min-w-0 space-y-4 border-y py-5">
        <p className="flex min-w-0 items-start gap-3 font-semibold" data-testid="meeting-when">
          <CalendarDays className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{meetingWhen(meeting)}</span>
        </p>
        {meeting.location_type === "online" ? (
          meeting.online_url && (
            <a
              data-testid="meeting-online-link"
              href={meeting.online_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-start gap-3 text-primary underline underline-offset-4"
            >
              <Video className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {t("meetings.joinOnline")}{" "}
                <span className="sr-only">{t("common.opensInNewTab")}</span>
              </span>
            </a>
          )
        ) : (
          <p data-testid="meeting-location" className="flex min-w-0 items-start gap-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">{meeting.location}</span>
          </p>
        )}
        <dl className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          {!single && (
            <div className="min-w-0">
              <dt className="text-muted-foreground">{t("work.scope.label")}</dt>
              <dd className="flex min-w-0" data-testid="meeting-scope">
                <MeetingScope meeting={meeting} />
              </dd>
            </div>
          )}
          <div className="min-w-0">
            <dt className="text-muted-foreground">{t("meetings.createdBy")}</dt>
            <dd className="[overflow-wrap:anywhere]" data-testid="meeting-creator">
              {meeting.created_by_name ?? t("common.formerMember")}
            </dd>
          </div>
        </dl>
        <Link
          to="/events/$id"
          params={{ id: meeting.event_id }}
          data-testid="meeting-open-calendar"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          <CalendarRange className="size-4 shrink-0" aria-hidden />
          {t("meetings.openCalendar")}
        </Link>
      </div>
      {meeting.description && (
        <p
          data-testid="meeting-description"
          className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]"
        >
          {meeting.description}
        </p>
      )}
      {editor && (
        <section className="min-w-0 space-y-3" aria-label={t("meetings.actions")}>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              data-testid="meeting-edit"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              <Pencil />
              {t("meetings.edit")}
            </Button>
            {meeting.status === "scheduled" && (
              <>
                <Button
                  data-testid="meeting-complete"
                  variant="outline"
                  className="h-11"
                  disabled={busy}
                  onClick={() => void changeStatus("completed")}
                >
                  <CircleCheck />
                  {t("meetings.complete")}
                </Button>
                <Button
                  data-testid="meeting-cancel"
                  variant="outline"
                  className="h-11 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={askCancel}
                >
                  <X />
                  {t("meetings.cancel")}
                </Button>
              </>
            )}
            {meeting.status === "cancelled" && (
              <Button
                data-testid="meeting-reschedule"
                variant="outline"
                className="h-11"
                disabled={busy}
                onClick={() => setRescheduling(true)}
              >
                <RotateCcw />
                {t("meetings.reschedule")}
              </Button>
            )}
            {meeting.status === "completed" && (
              <Button
                data-testid="meeting-reopen"
                variant="outline"
                className="h-11"
                disabled={busy}
                onClick={() => void changeStatus("scheduled")}
              >
                <RotateCcw />
                {t("meetings.reopen")}
              </Button>
            )}
            <Button
              data-testid="meeting-delete"
              variant="destructive"
              className="h-11"
              disabled={busy}
              onClick={askDelete}
            >
              <Trash2 />
              {t("meetings.delete")}
            </Button>
          </div>
        </section>
      )}
      {meeting.from_last && <MeetingFromLast fromLast={meeting.from_last} />}
      <MeetingAgenda meeting={meeting} />
      <section
        data-testid="meeting-invitees"
        aria-labelledby="meeting-invitees-title"
        className="min-w-0 rounded-2xl border bg-card p-4 shadow-soft sm:p-6"
      >
        <h2 id="meeting-invitees-title" className="text-xl font-semibold">
          <button
            type="button"
            data-testid="meeting-invitees-toggle"
            data-count={meeting.invitees.length}
            aria-expanded={inviteesOpen}
            aria-controls="meeting-invitees-body"
            onClick={() => setInviteesOpen((open) => !open)}
            className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-lg px-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn("size-5 shrink-0 transition-transform", !inviteesOpen && "-rotate-90")}
              aria-hidden
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {inviteesHeader(
                t,
                t("meetings.invitees"),
                meeting.invitees.map((p) => p.full_name ?? t("common.formerMember")),
              )}
            </span>
          </button>
        </h2>
        <div id="meeting-invitees-body" hidden={!inviteesOpen}>
          {inviteesOpen &&
            (meeting.invitees.length === 0 ? (
              <p data-testid="meeting-invitees-empty" className="mt-3 text-muted-foreground">
                {t("meetings.noInvitees")}
              </p>
            ) : (
              <ul className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                {meeting.invitees.map((p) => (
                  <li
                    key={p.id}
                    data-testid="meeting-invitee"
                    data-user-id={p.id}
                    className="min-w-0 rounded-lg border px-3 py-2"
                  >
                    <span className="block truncate font-medium" title={p.full_name ?? ""}>
                      {p.full_name ?? t("common.formerMember")}
                    </span>
                    {p.role && (
                      <span className="block text-xs text-muted-foreground">
                        {t(`common.roles.${p.role}`)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </section>
      <MeetingFiles meeting={meeting} />
      <MeetingSeriesPanel
        key={`${meeting.id}:${meeting.series?.agenda_template.join("\n")}`}
        meeting={meeting}
      />
      {editor && (
        <>
          <MeetingFormDialog
            open={editing}
            mode="edit"
            meeting={meeting}
            onClose={() => setEditing(false)}
            testId="meeting-form"
          />
          {/* Rescheduling a cancelled meeting: choose a new time, then it is scheduled again. */}
          <MeetingFormDialog
            open={rescheduling}
            mode="edit"
            meeting={meeting}
            testId="meeting-reschedule-form"
            seriesMode="this"
            onClose={() => setRescheduling(false)}
            onSaved={() => void changeStatus("scheduled")}
          />
        </>
      )}
      <EventDialog
        open={confirm !== null && editor}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        title={confirm === "delete" ? t("meetings.deleteTitle") : t("meetings.cancelTitle")}
        testId="meeting-confirm-dialog"
      >
        <p className="text-muted-foreground">
          {confirm === "delete" ? t("meetings.deleteText") : t("meetings.cancelText")}
        </p>
        {error && (
          <p role="alert" data-testid="meeting-confirm-error" className="mt-3 text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            data-testid="meeting-confirm-dismiss"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            {confirm === "delete" ? t("common.cancel") : t("meetings.keep")}
          </Button>
          {confirm === "delete" ? (
            <Button
              data-testid="meeting-delete-confirm"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              <Trash2 />
              {busy ? t("meetings.deleting") : t("meetings.delete")}
            </Button>
          ) : (
            <Button
              data-testid="meeting-cancel-confirm"
              variant="destructive"
              disabled={busy}
              onClick={() => void changeStatus("cancelled")}
            >
              <X />
              {busy ? t("common.saving") : t("meetings.cancel")}
            </Button>
          )}
        </div>
      </EventDialog>
      <MeetingScopeDialog
        open={scopeAction !== null && editor}
        action={scopeAction ?? "cancel"}
        busy={busy}
        error={error}
        onClose={() => setScopeAction(null)}
        onConfirm={(mode) => void confirmScope(meeting, mode)}
      />
    </article>
  );
}
