import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { useCanRequestEvents } from "@/lib/use-event-requests";
import { Button } from "@/components/ui/button";
import { EventRequestForm } from "./EventRequestForm";

export function RequestEventButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
      {open && (
        <EventRequestForm
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void navigate({ to: "/requests" });
          }}
        />
      )}
    </>
  );
}
