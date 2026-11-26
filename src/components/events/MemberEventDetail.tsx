// The signed-in view of an event (/events/:id). Loaded only for members, so the public page never downloads it.
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { BranchName } from "@/components/app/BranchName";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Share2,
  Download,
  Video,
  Pencil,
  X,
  MapPin,
  ChevronLeft,
  ChevronRight,
  FileText,
  CalendarDays,
  Trash2,
  Repeat,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { getEvent, cancelEvent } from "@/lib/events.functions";
import { deleteEvent, deleteSeries } from "@/lib/delete-event.functions";
import { eventStart, eventWhen, isMeetingEvent, londonToIso } from "@/lib/event-rules";
import { describeRule, type SeriesInfo } from "@/lib/recurrence";
import { AddToCalendarMenu } from "@/components/events/AddToCalendarMenu";
import { dateLocale, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EventForm } from "@/components/events/EventForm";
import { EventDialog } from "@/components/events/EventDialog";
import { CategoryIcon } from "@/components/events/EventCard";
import { HappeningNowBadge } from "@/components/events/HappeningNowBadge";
import { ExternalBadge } from "@/components/events/ExternalBadge";
import { PublicBadge } from "@/components/events/PublicBadge";
import { EventLinkedTasks } from "@/components/tasks/EventLinkedTasks";
import { RecurringScopeDialog, type SeriesMode } from "@/components/events/RecurringScopeDialog";
import { EventStatusBadge } from "@/components/events/EventStatus";
import { cancelledTitle } from "@/components/events/event-status-styles";
import { ManagerRegistrations, RegistrationPanel } from "@/components/events/EventRegistration";
import { MeetingEventActions } from "@/components/events/MeetingEventActions";
import { AttendeeList } from "@/components/events/AttendeeList";
import { AnnounceButton } from "@/components/events/AnnounceDialog";
import { EventVideos } from "@/components/events/EventVideos";
import { PastEventDialog } from "@/components/events/PastEventDialog";

const route = getRouteApi("/_app/events_/$id");

export function MemberEventDetail() {
  const { id } = route.useParams(),
    { t } = useTranslation();
  const { session, profile, roles } = useAuth();
  const nc = roles.includes("national_coordinator");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const fetch = useServerFn(getEvent),
    cancel = useServerFn(cancelEvent),
    remove = useServerFn(deleteEvent),
    removeSeries = useServerFn(deleteSeries),
    qc = useQueryClient(),
    navigate = useNavigate();
  const query = useQuery({
    queryKey: ["event", id, session?.user.id, profile?.status],
    queryFn: () => fetch({ data: { id } }),
    enabled: profile?.status === "active",
    staleTime: 240000,
    refetchInterval: 240000,
  });
  const [editing, setEditing] = useState(false),
    [cancelling, setCancelling] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Recurring events: which action asks for 'this' / 'following' / 'all', and the chosen edit scope.
  const [scopeAction, setScopeAction] = useState<"edit" | "delete" | null>(null),
    [editMode, setEditMode] = useState<SeriesMode | undefined>();
  const [image, setImage] = useState<number | null>(null),
    touch = useRef<number | null>(null);
  // "Edit" links (dashboard drafts) open the form once the user is known to manage the event.
  // A meeting's calendar entry is managed through its meeting (MeetingEventActions), never with the event form.
  const meetingEntry = !!query.data?.event && isMeetingEvent(query.data.event);
  // A meeting's entry: the scope, branch and region facts are collapsed under "Details".
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { edit } = route.useSearch(),
    canManageLoaded = !!query.data?.canManage && !meetingEntry,
    recurring = !!query.data?.event?.series_id;
  useEffect(() => {
    if (!edit || !canManageLoaded) return;
    if (recurring) setScopeAction("edit");
    else setEditing(true);
    void navigate({ to: "/events/$id", params: { id }, search: {}, replace: true });
  }, [edit, canManageLoaded, recurring, id, navigate]);
  if (query.isLoading) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (query.isError)
    return (
      <div role="alert" className="space-y-3">
        <p className="text-destructive">{t("events.loadError")}</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  if (!query.data?.event)
    return (
      <div data-testid="event-detail-not-found" className="space-y-4">
        <p>{t("events.notFound")}</p>
        <Button asChild variant="outline">
          <Link to="/calendar">
            <ArrowLeft />
            {t("events.back")}
          </Link>
        </Button>
      </div>
    );
  const { event, deletion } = query.data;
  const meetingId = query.data.meetingId ?? null;
  // Event management (form, registrations, files) never applies to a meeting's entry.
  const canManage = query.data.canManage && !meetingEntry;
  const series: SeriesInfo | null = query.data.series ?? null;
  const canDelete = deletion.canDelete;
  const images = event.media.filter((m) => m.kind === "image" && m.url),
    pdfs = event.media.filter((m) => m.kind === "pdf" && m.url),
    documents = event.media.filter((m) => m.kind === "document" && m.url);
  const when = eventWhen(event, dateLocale());
  // A past-event record: photos and videos only (no registration, sharing or cancelling).
  const pastRecord = !!event.past_record;
  const publicEvent = event.audience === "public" && !meetingEntry;
  const startValue = eventStart(event);
  const upcoming =
    !!startValue &&
    (event.all_day ? Date.parse(londonToIso(`${startValue}T00:00`)) : Date.parse(startValue)) >
      now.getTime();
  const selected = image === null ? null : images[image];
  function next(delta: number) {
    setImage((current) =>
      current === null || !images.length ? null : (current + delta + images.length) % images.length,
    );
  }
  const url = `${window.location.origin}/events/${event.id}`;
  async function confirmCancel() {
    setBusy(true);
    setError("");
    try {
      await cancel({ data: { id } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["event", id] }),
        qc.invalidateQueries({ queryKey: ["events"] }),
        qc.invalidateQueries({ queryKey: ["registration-summary", id] }),
        qc.invalidateQueries({ queryKey: ["registrations", id] }),
      ]);
      setCancelling(false);
      toast.success(t("events.cancelledSuccess"));
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  async function chooseScope(mode: SeriesMode) {
    if (scopeAction === "edit") {
      setEditMode(mode);
      setScopeAction(null);
      setEditing(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "this") await remove({ data: { id } });
      else await removeSeries({ data: { id, mode } });
      qc.removeQueries({ queryKey: ["event", id] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["events"] }),
        qc.invalidateQueries({ queryKey: ["recycle-bin"] }),
      ]);
      toast.success(t("events.deletedSuccess"));
      setScopeAction(null);
      await navigate({ to: "/calendar" });
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmDelete() {
    setBusy(true);
    setError("");
    try {
      await remove({ data: { id } });
      qc.removeQueries({ queryKey: ["event", id] });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["events"] }),
        qc.invalidateQueries({ queryKey: ["recycle-bin"] }),
      ]);
      toast.success(t("events.deletedSuccess"));
      await navigate({ to: "/calendar" });
    } catch (e) {
      setError(translateError(e));
      await qc.invalidateQueries({ queryKey: ["event", id] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      data-testid="event-detail"
      data-event-id={event.id}
      data-status={event.status}
      data-category={event.category}
      className={`space-y-6 ${event.status === "published" ? "border-l-4 border-l-status-published pl-4" : event.status === "cancelled" ? "border-l-4 border-l-status-cancelled pl-4" : "rounded-lg border border-dashed border-status-draft-border bg-status-draft-bg p-4"}`}
    >
      <Link
        to="/calendar"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        {t("events.back")}
      </Link>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            data-testid="event-detail-category"
            variant="secondary"
            className={meetingEntry ? "gap-1" : undefined}
          >
            {meetingEntry && <Users className="size-3.5" aria-hidden />}
            {t(`events.categories.${event.category}`)}
          </Badge>
          <EventStatusBadge status={event.status} />
          <HappeningNowBadge event={event} now={now} />
          {event.audience === "public" && <PublicBadge />}
          {pastRecord && (
            <Badge data-testid="event-past-record-badge" variant="outline">
              {t("pastEvents.badge")}
            </Badge>
          )}
          {event.is_external && <ExternalBadge />}
          {event.series_id && (
            <span
              data-testid="event-recurring-icon"
              title={t("events.recurring.label")}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground"
            >
              <Repeat className="size-4" aria-hidden />
              <span>{t("events.recurring.label")}</span>
            </span>
          )}
        </div>
        <h1
          data-testid="event-detail-title"
          className={`break-words text-3xl font-bold sm:text-4xl ${cancelledTitle(event.status)}`}
        >
          {event.title}
        </h1>
        <p
          data-testid="event-detail-organizer"
          className="break-words text-lg text-muted-foreground"
        >
          {event.is_external
            ? t("events.organisedBy", { organizer: event.organizer })
            : event.organizer}
        </p>
      </header>
      {meetingEntry && (
        <section className="space-y-2 rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("events.meetingEntryHint")}</p>
          {meetingId && (
            <Button asChild className="h-11">
              <Link to="/meetings/$id" params={{ id: meetingId }} data-testid="event-open-meeting">
                <Users />
                {t("events.openMeeting")}
              </Link>
            </Button>
          )}
        </section>
      )}
      {!meetingEntry && (
        <section
          data-testid="event-detail-gallery"
          aria-label={t("events.gallery")}
          className="space-y-3"
        >
          {images.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {images.map((m, i) => (
                <Button
                  key={m.id}
                  variant="ghost"
                  data-testid="event-detail-image"
                  data-position={m.position}
                  aria-label={t("events.imageNumber", { position: i + 1, count: images.length })}
                  className={`h-auto overflow-hidden rounded-lg border bg-muted p-0 ${i === 0 ? "sm:col-span-2" : ""}`}
                  onClick={() => setImage(i)}
                >
                  <img
                    src={m.url ?? ""}
                    alt={event.title}
                    className={`block w-full bg-muted object-cover ${i === 0 ? "h-56 sm:h-80" : "h-44 sm:h-48"}`}
                  />
                </Button>
              ))}
            </div>
          ) : (
            <div className="flex h-36 items-center justify-center border-y bg-secondary text-secondary-foreground">
              <CategoryIcon category={event.category} className="size-14" />
            </div>
          )}
          {documents.length > 0 && (
            <ul aria-label={t("events.documents")} className="space-y-2">
              {documents.map((m) => (
                <li
                  key={m.id}
                  data-testid="event-media-document"
                  className="flex min-w-0 items-center gap-3 rounded-lg border bg-card p-3"
                >
                  <FileText className="size-6 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 break-all text-sm">
                    {m.original_name || m.storage_path.split("/").pop()}
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <a
                      data-testid="event-media-download"
                      href={m.url ?? ""}
                      download={m.original_name || undefined}
                      rel="noopener noreferrer"
                    >
                      <Download />
                      {t("events.download")}
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {pdfs.map((m, i) => (
            <Button key={m.id} asChild variant="outline">
              <a
                data-testid="event-detail-pdf-link"
                href={m.url ?? ""}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText />
                {t("events.leaflet")}
                {pdfs.length > 1 ? ` ${i + 1}` : ""}
              </a>
            </Button>
          ))}
        </section>
      )}
      <div className="space-y-4 border-y py-5">
        <div className="flex items-start gap-3">
          <CalendarDays className="mt-1 size-5 shrink-0 text-primary" />
          <div>
            <p data-testid="event-detail-when" className="font-semibold">
              {when ? when.text : t("events.unscheduled")}
            </p>
            {when?.allDay && <p className="text-muted-foreground">{t("events.allDay")}</p>}
            {series && (
              <p
                data-testid="event-repeat-summary"
                className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"
              >
                <Repeat className="size-4" aria-hidden />
                {describeRule(
                  series.rule,
                  {
                    date: series.dtstart_local.slice(0, 10),
                    time: series.dtstart_local.slice(11, 16),
                    allDay: series.all_day,
                  },
                  t,
                  dateLocale(),
                )}
              </p>
            )}
          </div>
        </div>
        {event.location_type === "online" && event.online_url && (
          <a
            data-testid="event-detail-online-link"
            href={event.online_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 text-primary underline underline-offset-4"
          >
            <Video className="mt-0.5 size-5 shrink-0" />
            <span className="break-all">{t("events.joinOnline")}</span>
          </a>
        )}
        {event.location_type !== "online" && event.location_tba && (
          <p
            data-testid="event-detail-location-tba"
            className="flex items-start gap-3 text-muted-foreground"
          >
            <MapPin className="mt-0.5 size-5 shrink-0" />
            <span>{t("events.locationTba")}</span>
          </p>
        )}
        {event.location_type !== "online" && !event.location_tba && event.location && (
          <a
            data-testid="event-detail-location-link"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 text-primary underline underline-offset-4"
          >
            <MapPin className="mt-0.5 size-5 shrink-0" />
            <span className="break-words">{event.location}</span>
          </a>
        )}
        {(() => {
          const facts = (
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("events.scope")}</dt>
                <dd>{t(`events.${event.scope}`)}</dd>
              </div>
              {query.data.branchName && (
                <div>
                  <dt className="text-muted-foreground">{t("events.branch")}</dt>
                  <dd>
                    <BranchName name={query.data.branchName} />
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">{t("events.region")}</dt>
                <dd>{query.data.regionName ?? "—"}</dd>
              </div>
              {!meetingEntry && (
                <div>
                  <dt className="text-muted-foreground">{t("events.capacity")}</dt>
                  <dd>{event.capacity ?? t("events.unlimited")}</dd>
                </div>
              )}
            </dl>
          );
          // A meeting's entry: scope, branch and region are rarely needed, so they sit in a collapsed "Details".
          if (!meetingEntry) return facts;
          return (
            <div className="min-w-0" data-testid="event-meeting-details">
              <button
                type="button"
                data-testid="event-meeting-details-toggle"
                aria-expanded={detailsOpen}
                aria-controls="event-meeting-details-body"
                onClick={() => setDetailsOpen((v) => !v)}
                className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight
                  className={`size-4 shrink-0 transition-transform ${detailsOpen ? "rotate-90" : ""}`}
                  aria-hidden
                />
                {t("events.meetingDetails")}
              </button>
              <div id="event-meeting-details-body" hidden={!detailsOpen} className="pt-2">
                {detailsOpen && facts}
              </div>
            </div>
          );
        })()}
      </div>
      {event.description && (
        <p className="whitespace-pre-wrap break-words leading-relaxed">{event.description}</p>
      )}
      {publicEvent && (pastRecord || canManage) && (
        <EventVideos eventId={event.id} canManage={canManage} />
      )}
      {event.status !== "cancelled" && !pastRecord && (
        <div
          data-testid="event-share-actions"
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
        >
          <AddToCalendarMenu event={event} url={url} series={series} />
          <Button asChild variant="outline" className="h-11">
            <a
              data-testid="event-share-whatsapp-button"
              href={`https://wa.me/?text=${encodeURIComponent(`${event.title}\n${when ? `${when.text}${when.allDay ? ` · ${t("events.allDay")}` : ""}` : t("events.unscheduled")}\n${url}`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Share2 />
              {t("events.whatsapp")}
            </a>
          </Button>
        </div>
      )}
      {!meetingEntry && !pastRecord && <RegistrationPanel event={event} now={now} />}
      {/* Public events: members and guests together (scope managers; National Coordinators see counts only). */}
      {canManage && !pastRecord && publicEvent && !nc && event.status !== "draft" && (
        <AttendeeList event={event} now={now} />
      )}
      {canManage && !publicEvent && <ManagerRegistrations event={event} now={now} />}
      <EventLinkedTasks
        event={{
          id: event.id,
          title: event.title,
          scope: event.scope,
          branch_id: event.branch_id,
          region_id: event.region_id,
        }}
      />
      {meetingEntry && meetingId && (
        <MeetingEventActions meetingId={meetingId} eventId={event.id} />
      )}
      {canManage && (
        <section className="space-y-3 border-t pt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {!deletion.pending && (
              <>
                <Button
                  data-testid="event-edit-button"
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    setError("");
                    if (event.series_id) setScopeAction("edit");
                    else setEditing(true);
                  }}
                >
                  <Pencil />
                  {t("events.edit")}
                </Button>
                {publicEvent && !pastRecord && event.status === "published" && upcoming && (
                  <AnnounceButton
                    eventId={event.id}
                    branchId={event.branch_id}
                    regionId={event.region_id}
                  />
                )}
                {event.status !== "cancelled" && !pastRecord && (
                  <Button
                    data-testid="event-cancel-event-button"
                    variant="outline"
                    className="h-11 border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setError("");
                      setCancelling(true);
                    }}
                  >
                    <X />
                    {t("events.cancelEvent")}
                  </Button>
                )}
              </>
            )}
            {canDelete && (
              <Button
                data-testid="event-delete-button"
                variant="destructive"
                className="h-11"
                disabled={busy}
                onClick={() => {
                  setError("");
                  if (event.series_id) setScopeAction("delete");
                  else setDeleting(true);
                }}
              >
                <Trash2 />
                {t("events.deleteEvent")}
              </Button>
            )}
          </div>
          {deletion.pending && (
            <p className="text-sm text-muted-foreground">{t("events.deletePending")}</p>
          )}
        </section>
      )}
      {editing && canManage && pastRecord && (
        <PastEventDialog
          event={event}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
          }}
        />
      )}
      {editing && canManage && !pastRecord && (
        <EventForm
          event={event}
          series={series}
          {...(event.series_id && editMode ? { seriesMode: editMode } : {})}
          onClose={() => setEditing(false)}
          onSaved={(savedId) => {
            setEditing(false);
            if (savedId !== id) void navigate({ to: "/events/$id", params: { id: savedId } });
          }}
        />
      )}
      <RecurringScopeDialog
        open={scopeAction !== null && canManage}
        action={scopeAction ?? "edit"}
        busy={busy}
        error={scopeAction === "delete" ? error : ""}
        onChoose={(mode) => void chooseScope(mode)}
        onClose={() => {
          if (!busy) setScopeAction(null);
        }}
      />
      <EventDialog
        open={cancelling && canManage}
        onClose={() => {
          if (!busy) setCancelling(false);
        }}
        title={t("events.cancelTitle")}
      >
        <p className="text-muted-foreground">{t("events.cancelText")}</p>
        {error && (
          <p role="alert" className="mt-3 text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={() => setCancelling(false)}>
            {t("events.keepEvent")}
          </Button>
          <Button
            data-testid="confirm-dialog-confirm-button"
            variant="destructive"
            disabled={busy}
            onClick={confirmCancel}
          >
            {busy ? t("common.saving") : t("events.cancelEvent")}
          </Button>
        </div>
      </EventDialog>
      <EventDialog
        open={deleting && canManage}
        onClose={() => {
          if (!busy) setDeleting(false);
        }}
        title={t("events.deleteTitle")}
      >
        <p className="text-muted-foreground">{t("events.deleteText")}</p>
        {error && (
          <p role="alert" className="mt-3 text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="event-delete-confirm"
            variant="destructive"
            disabled={busy || !canDelete}
            onClick={confirmDelete}
          >
            <Trash2 />
            {busy ? t("events.deleting") : t("recycleBin.delete")}
          </Button>
        </div>
      </EventDialog>
      <EventDialog
        open={image !== null && !!selected}
        onClose={() => setImage(null)}
        title={t("events.gallery")}
        testId="event-detail-lightbox"
        fullscreen
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") next(1);
            if (e.key === "ArrowLeft") next(-1);
          }}
          onTouchStart={(e) => {
            touch.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const end = e.changedTouches[0]?.clientX;
            if (touch.current !== null && end !== undefined && Math.abs(end - touch.current) > 40)
              next(end < touch.current ? 1 : -1);
            touch.current = null;
          }}
        >
          <img
            src={selected?.url ?? ""}
            alt={event.title}
            className="min-h-0 w-full flex-1 object-contain"
          />
          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="outline"
              size="icon"
              aria-label={t("events.previous")}
              onClick={() => next(-1)}
            >
              <ChevronLeft />
            </Button>
            <p className="text-sm text-muted-foreground">
              {t("events.imageNumber", { position: (image ?? 0) + 1, count: images.length })}
            </p>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("events.next")}
              onClick={() => next(1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </EventDialog>
    </article>
  );
}
