import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ListPlus } from "lucide-react";
import { EventDialog } from "@/components/events/EventDialog";
import { Button } from "@/components/ui/button";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { CarryOverChoice } from "@/lib/meetings";
import { carryOverAgenda, listMeetingCarryIn } from "@/lib/meetings.functions";
import { MeetingCarryPicker } from "./MeetingCarryOver";

/**
 * "Add from other meetings" on the meeting page (people who can edit the meeting): the carry-over picker for this
 * meeting (list_meeting_carry_in: unresolved items of other meetings of the same place, past or upcoming, one per
 * chain, none the meeting already has). The chosen items and decisions are copied after the agenda
 * (carry_over_agenda, the same checks as for a new meeting); their tasks show here too, never moved or copied.
 *
 * Test ids: `meeting-add-from-open`, `meeting-add-from-dialog`, `meeting-add-from-loading`, `meeting-add-from-empty`,
 * `meeting-add-from-cancel`, `meeting-add-from-submit` (data-count), and the picker's with prefix `meeting-add-from`.
 */
export function MeetingCarryIn({
  meetingId,
  disabled,
}: {
  meetingId: string;
  disabled?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fetchCarryIn = useServerFn(listMeetingCarryIn);
  const carry = useServerFn(carryOverAgenda);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<CarryOverChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["meeting-carry-in", meetingId],
    queryFn: () => fetchCarryIn({ data: { meetingId } }),
    enabled: open,
    staleTime: 0,
  });
  const meetings = query.data ?? [];
  const close = () => {
    if (busy) return;
    setOpen(false);
    setValue([]);
  };

  async function submit() {
    setBusy(true);
    try {
      const { count } = await carry({ data: { meetingId, items: value } });
      toast.success(t("meetings.carry.done", { count }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["meeting", meetingId] }),
        qc.invalidateQueries({ queryKey: ["meeting-series-tasks"] }),
        qc.invalidateQueries({ queryKey: ["meeting-carry-in"] }),
        qc.invalidateQueries({ queryKey: ["meeting-carry-over"] }),
        qc.invalidateQueries({ queryKey: ["task-sources"] }),
      ]);
      setOpen(false);
      setValue([]);
    } catch (e) {
      toast.error(translateError(e));
      // What can be added may have changed (for example someone else added the item meanwhile).
      void qc.invalidateQueries({ queryKey: ["meeting-carry-in", meetingId] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        data-testid="meeting-add-from-open"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <ListPlus />
        {t("meetings.carryIn.open")}
      </Button>
      <EventDialog
        open={open}
        onClose={close}
        title={t("meetings.carryIn.title")}
        testId="meeting-add-from-dialog"
      >
        {query.isPending ? (
          <p data-testid="meeting-add-from-loading" className="text-sm text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : query.isError ? (
          <p className="text-sm text-destructive">{translateError(query.error)}</p>
        ) : meetings.length === 0 ? (
          <p data-testid="meeting-add-from-empty" className="text-sm text-muted-foreground">
            {t("meetings.carryIn.empty")}
          </p>
        ) : (
          <MeetingCarryPicker
            meetings={meetings}
            value={value}
            onChange={setValue}
            disabled={busy}
            testId="meeting-add-from"
            hint={t("meetings.carryIn.hint")}
          />
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            data-testid="meeting-add-from-cancel"
            disabled={busy}
            onClick={close}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            className="h-11"
            data-testid="meeting-add-from-submit"
            data-count={value.length}
            disabled={busy || value.length === 0}
            onClick={() => void submit()}
          >
            {value.length
              ? t("meetings.carryIn.submit", { count: value.length })
              : t("meetings.carryIn.submitNone")}
          </Button>
        </div>
      </EventDialog>
    </>
  );
}
