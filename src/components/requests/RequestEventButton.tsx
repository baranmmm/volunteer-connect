import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { useCanRequestEvents } from "@/lib/use-event-requests";
import { Button } from "@/components/ui/button";
import { EventRequestForm } from "./EventRequestForm";

export function RequestEventButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const allowed = useCanRequestEvents();
  if (!allowed) return null;
  return (
    <>
      <Button
        data-testid="event-request-open-button"
        variant={variant}
        className="h-11"
        onClick={() => setOpen(true)}
      >
        <Send />
        {t("requests.open")}
      </Button>
      <RequestEventDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The event request form on its own (e.g. opened from the phone Calendar's "More actions" menu); after saving it goes
 * to My requests. Check useCanRequestEvents() before offering it.
 */
export function RequestEventDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  if (!open) return null;
  return (
    <EventRequestForm
      onClose={onClose}
      onSaved={() => {
        onClose();
        void navigate({ to: "/requests", search: { tab: "mine" } });
      }}
    />
  );
}
