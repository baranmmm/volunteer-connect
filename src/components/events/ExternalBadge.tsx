import { useTranslation } from "react-i18next";
import { Globe2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Marks an event organised by someone else (added from an external request). */
export function ExternalBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  if (compact)
    return (
      <span
        data-testid="event-external-badge"
        title={t("events.external")}
        className="inline-flex shrink-0 text-muted-foreground"
      >
        <Globe2 className="size-3" aria-hidden />
        <span className="sr-only">{t("events.external")}</span>
      </span>
    );
  return (
    <Badge data-testid="event-external-badge" variant="outline" className={cn("gap-1")}>
      <Globe2 className="size-3.5" aria-hidden />
      {t("events.external")}
    </Badge>
  );
}
