import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import {
  deleteMeeting,
  deleteMeetingSeries,
  getMeeting,
  setMeetingStatus,
} from "@/lib/meetings.functions";
import { Button } from "@/components/ui/button";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import { EventDialog } from "./EventDialog";
import { RecurringScopeDialog, type SeriesMode } from "./RecurringScopeDialog";

/**
 * Actions on a meeting's calendar entry, for people who can edit the meeting: they act on the meeting (the database
 * mirrors them to the calendar entry). Same test ids as the event actions (event-edit-button, event-cancel-event-button,
 * event-delete-button, event-delete-confirm), plus event-reopen-meeting-button.
 */
export function MeetingEventActions({
  meetingId,
  eventId,
}: {
  meetingId: string;
  eventId: string;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient(),
    navigate = useNavigate();
  const fetchMeeting = useServerFn(getMeeting),
    setStatus = useServerFn(setMeetingStatus),
    remove = useServerFn(deleteMeeting),
    removeSeries = useServerFn(deleteMeetingSeries);
  // Same cache as the meeting page.
  const meeting = useQuery({
    queryKey: ["meeting", meetingId, uid],
    queryFn: () => fetchMeeting({ data: { id: meetingId } }),
    enabled: !!uid,
  });
  const [editing, setEditing] = useState(false),
    [cancelling, setCancelling] = useState(false),
    [deleting, setDeleting] = useState(false),
    [choosing, setChoosing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const data = meeting.data;
  if (!data?.can_edit) return null;
  const refresh = () =>
    Promise.all(
      [["event", eventId], ["events"], ["meeting", meetingId], ["meetings"]].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
  async function changeStatus(status: "cancelled" | "scheduled") {
    setBusy(true);
    setError("");
    try {
      await setStatus({ data: { id: meetingId, status } });
      await refresh();
      setCancelling(false);
      toast.success(t(`meetings.statusChanged.${status}`));
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirmDelete(mode: SeriesMode | null) {
    setBusy(true);
    setError("");
    try {
      if (mode) await removeSeries({ data: { id: meetingId, mode } });
      else await remove({ data: { id: meetingId } });
      qc.removeQueries({ queryKey: ["event", eventId] });
      qc.removeQueries({ queryKey: ["meeting", meetingId] });
      await Promise.all(
        [["events"], ["meetings"], ["recycle-bin"]].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
      toast.success(t("meetings.deleted"));
      setDeleting(false);
      setChoosing(false);
      await navigate({ to: "/calendar" });
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  const cancelled = data.status === "cancelled";
  return (
    <section data-testid="event-meeting-actions" className="space-y-3 border-t pt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          data-testid="event-edit-button"
          variant="outline"
          className="h-11"
          onClick={() => {
            setError("");
            setEditing(true);
          }}
        >
          <Pencil />
          {t("meetings.edit")}
        </Button>
        {cancelled ? (
          <Button
            data-testid="event-reopen-meeting-button"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => void changeStatus("scheduled")}
          >
            <RotateCcw />
            {t("meetings.reopen")}
          </Button>
        ) : (
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
            {t("meetings.cancel")}
          </Button>
        )}
        <Button
          data-testid="event-delete-button"
          variant="destructive"
          className="h-11"
          disabled={busy}
          onClick={() => {
            setError("");
            if (data.series_id) setChoosing(true);
            else setDeleting(true);
          }}
        >
          <Trash2 />
          {t("meetings.delete")}
        </Button>
      </div>
      {error && !cancelling && !deleting && !choosing && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <MeetingFormDialog
        open={editing}
        mode="edit"
        meeting={data}
        onClose={() => setEditing(false)}
        onSaved={() => void refresh()}
      />
      <EventDialog
        open={cancelling}
        onClose={() => {
          if (!busy) setCancelling(false);
        }}
        title={t("meetings.cancelTitle")}
      >
        <p className="text-muted-foreground">{t("meetings.cancelText")}</p>
        {error && (
          <p role="alert" className="mt-3 text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={() => setCancelling(false)}>
            {t("meetings.keep")}
          </Button>
          <Button
            data-testid="confirm-dialog-confirm-button"
            variant="destructive"
            disabled={busy}
            onClick={() => void changeStatus("cancelled")}
          >
            {busy ? t("common.saving") : t("meetings.cancel")}
          </Button>
        </div>
      </EventDialog>
      <EventDialog
        open={deleting}
        onClose={() => {
          if (!busy) setDeleting(false);
        }}
        title={t("meetings.deleteTitle")}
      >
        <p className="text-muted-foreground">{t("meetings.deleteText")}</p>
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
            disabled={busy}
            onClick={() => void confirmDelete(null)}
          >
            <Trash2 />
            {busy ? t("meetings.deleting") : t("meetings.delete")}
          </Button>
        </div>
      </EventDialog>
      <RecurringScopeDialog
        open={choosing}
        action="delete"
        busy={busy}
        error={error}
        onChoose={(mode) => void confirmDelete(mode)}
        onClose={() => {
          if (!busy) setChoosing(false);
        }}
      />
    </section>
  );
}
