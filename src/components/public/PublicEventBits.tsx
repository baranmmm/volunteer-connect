import { useTranslation } from "react-i18next";
import type { PublicEvent } from "@/lib/public-events";
import { Badge } from "@/components/ui/badge";

// Small pieces shared by the public event list and detail pages (kept apart so the list does not load the detail
// page and its guest registration form).

/** "Places available" / "Full" / "Registration closed" (never numbers). */
export function PublicRegistrationState({ state }: { state: PublicEvent["registration"] }) {
  const { t } = useTranslation();
  return (
    <Badge
      data-testid="public-event-registration"
      data-state={state}
      variant={state === "open" ? "secondary" : "outline"}
    >
      {t(`publicEvents.registration.${state}`)}
    </Badge>
  );
}

export function publicWhere(event: PublicEvent) {
  return [event.branch, event.region].filter(Boolean).join(", ");
}
