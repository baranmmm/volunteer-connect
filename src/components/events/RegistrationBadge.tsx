import { useTranslation } from "react-i18next";
import { CircleCheck, Hourglass } from "lucide-react";
import { registrationBadge } from "@/lib/registrations";
import type { HubEvent } from "@/lib/event-rules";
import { cn } from "@/lib/utils";

/** "Registered" / "Waitlisted" for the viewer's own registration. `compact`: month grid (icon below 6rem). */
export function RegistrationBadge({
  status,
  compact = false,
}: {
  status: HubEvent["my_registration"];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const badge = registrationBadge(status);
  if (!badge) return null;
  const Icon = badge === "registered" ? CircleCheck : Hourglass;
  const label = t(`registrations.badge.${badge}`);
  return (
    <span
      data-testid={`calendar-event-badge-${badge}`}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        badge === "registered"
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-muted-foreground/40 bg-muted text-muted-foreground",
        compact && "px-1 py-0",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className={compact ? "sr-only @min-[6rem]:not-sr-only" : undefined}>{label}</span>
    </span>
  );
}
