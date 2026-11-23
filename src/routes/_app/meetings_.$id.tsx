import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CalendarDays,
  CircleCheck,
  MapPin,
  Pencil,
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
import { MeetingStatusBadge } from "@/components/meetings/MeetingStatusBadge";
import { meetingWhen } from "@/components/meetings/meeting-ui";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { MeetingStatus } from "@/lib/meetings";
import { deleteMeeting, getMeeting, setMeetingStatus } from "@/lib/meetings.functions";
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
    remove = useServerFn(deleteMeeting);
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

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

  const editor = meeting.can_edit;
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
          <div className="min-w-0">
            <dt className="text-muted-foreground">{t("work.scope.label")}</dt>
            <dd className="flex min-w-0" data-testid="meeting-scope">
              <MeetingScope meeting={meeting} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">{t("meetings.createdBy")}</dt>
            <dd className="[overflow-wrap:anywhere]" data-testid="meeting-creator">
              {meeting.created_by_name ?? t("common.formerMember")}
            </dd>
          </div>
        </dl>
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
                  onClick={() => {
                    setError("");
                    setConfirm("cancel");
                  }}
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
              onClick={() => {
                setError("");
                setConfirm("delete");
              }}
            >
              <Trash2 />
              {t("meetings.delete")}
            </Button>
          </div>
        </section>
      )}
      <section
        data-testid="meeting-invitees"
        aria-labelledby="meeting-invitees-title"
        className="min-w-0 rounded-2xl border bg-card p-4 shadow-soft sm:p-6"
      >
        <h2 id="meeting-invitees-title" className="text-xl font-semibold">
          {t("meetings.invitees")}{" "}
          <span className="text-muted-foreground">({meeting.invitees.length})</span>
        </h2>
        {meeting.invitees.length === 0 ? (
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
        )}
      </section>
      <MeetingAgenda meeting={meeting} />
      <MeetingFiles meeting={meeting} />
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
    </article>
  );
}
