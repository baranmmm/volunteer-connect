import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EventDialog } from "@/components/events/EventDialog";
import { Button } from "@/components/ui/button";
import { MEETING_SERIES_MODES, type MeetingSeriesMode } from "@/lib/meetings";

export type MeetingScopeAction = "edit" | "cancel" | "delete";

/**
 * Which occurrences of a recurring meeting a change applies to: this one, this and the following ones, or all.
 * Test ids: meeting-scope-dialog, meeting-scope-this|following|all (radios), meeting-scope-confirm,
 * meeting-scope-dismiss, meeting-scope-error.
 */
export function MeetingScopeDialog({
  open,
  action,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  action: MeetingScopeAction;
  busy: boolean;
  error?: string;
  onConfirm: (mode: MeetingSeriesMode) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<MeetingSeriesMode>("this");
  useEffect(() => {
    if (open) setMode("this");
  }, [open]);
  const destructive = action !== "edit";
  return (
    <EventDialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t(`meetings.scope.${action}Title`)}
      testId="meeting-scope-dialog"
    >
      <fieldset className="min-w-0 space-y-2" disabled={busy}>
        <legend className="mb-2 text-muted-foreground">{t(`meetings.scope.${action}Text`)}</legend>
        {MEETING_SERIES_MODES.map((value) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3"
          >
            <input
              type="radio"
              name="meeting-scope"
              className="size-4"
              data-testid={`meeting-scope-${value}`}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            {t(`meetings.scope.${value}`)}
          </label>
        ))}
      </fieldset>
      {error && (
        <p
          role="alert"
          data-testid="meeting-scope-error"
          className="mt-3 text-sm text-destructive [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          data-testid="meeting-scope-dismiss"
          disabled={busy}
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          className="h-11"
          variant={destructive ? "destructive" : "default"}
          data-testid="meeting-scope-confirm"
          disabled={busy}
          onClick={() => onConfirm(mode)}
        >
          {busy ? t("common.saving") : t(`meetings.scope.${action}Confirm`)}
        </Button>
      </div>
    </EventDialog>
  );
}
