import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Marks a meeting's calendar entry (category "meeting"): invite-only, no registration. */
export function MeetingBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const label = t("events.categories.meeting");
  if (compact)
    return (
      <span
        data-testid="event-meeting-badge"
        title={label}
        className="inline-flex shrink-0 text-primary"
      >
        <Users className="size-3" aria-hidden />
        <span className="sr-only">{label}</span>
      </span>
    );
  return (
    <Badge
      data-testid="event-meeting-badge"
      variant="outline"
      className="gap-1 border-primary/40 text-primary"
    >
      <Users className="size-3.5" aria-hidden />
      {label}
    </Badge>
  );
}
