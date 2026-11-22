import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EventDialog } from "./EventDialog";

export type SeriesMode = "this" | "following" | "all";

/** Google Calendar style choice before editing or deleting an occurrence of a recurring event. */
export function RecurringScopeDialog({
  open,
  action,
  busy,
  error,
  onChoose,
  onClose,
}: {
  open: boolean;
  action: "edit" | "delete";
  busy: boolean;
  error?: string;
  onChoose: (mode: SeriesMode) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const modes: SeriesMode[] = ["this", "following", "all"];
  return (
    <EventDialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t(`events.recurring.${action}Title`)}
      testId="recurring-scope-dialog"
    >
      <p className="text-muted-foreground">{t(`events.recurring.${action}Text`)}</p>
      <div className="mt-5 flex flex-col gap-2">
        {modes.map((mode) => (
          <Button
            key={mode}
            data-testid={`recurring-scope-${mode}`}
            variant={action === "delete" ? "outline" : "secondary"}
            className={`h-11 justify-start ${action === "delete" ? "border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive" : ""}`}
            disabled={busy}
            onClick={() => onChoose(mode)}
          >
            {t(`events.recurring.${mode}`)}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </EventDialog>
  );
}
