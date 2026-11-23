import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Marks a public event: shown to followers and on the website (signed-out /events pages). */
export function PublicBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  if (compact)
    return (
      <span data-testid="event-public-badge" title={t("events.public")} className="inline-flex shrink-0 text-muted-foreground">
        <Eye className="size-3" aria-hidden />
        <span className="sr-only">{t("events.public")}</span>
      </span>
    );
  return (
    <Badge data-testid="event-public-badge" variant="outline" className="gap-1">
      <Eye className="size-3.5" aria-hidden />
      {t("events.public")}
    </Badge>
  );
}
