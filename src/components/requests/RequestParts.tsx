import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Download, FileText, Globe2, Lightbulb } from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { RequestType } from "@/lib/event-requests";
import { listRequestMedia } from "@/lib/event-requests.functions";
import { Badge } from "@/components/ui/badge";

/** "External" (an event someone else organises) or "Proposal" (one we could organise). */
export function RequestTypeBadge({ type, testId }: { type: RequestType; testId?: string }) {
  const { t } = useTranslation();
  const Icon = type === "external" ? Globe2 : Lightbulb;
  return (
    <Badge data-testid={testId} data-type={type} variant="secondary" className="gap-1">
      <Icon className="size-3.5" aria-hidden />
      {t(`requests.types.${type}`)}
    </Badge>
  );
}

/** Leaflet / invitation files of a request: image previews and download links (5-minute signed URLs). */
export function RequestAttachments({ requestId, testId }: { requestId: string; testId?: string }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const fetch = useServerFn(listRequestMedia);
  const query = useQuery({
    queryKey: ["event-request-media", requestId, session?.user.id],
    queryFn: () => fetch({ data: { id: requestId } }),
    staleTime: 60000,
  });
  const files = (query.data ?? []).filter((f) => f.uploaded && f.url);
  if (query.isLoading || !files.length) return null;
  return (
    <section data-testid={testId} aria-label={t("requests.attachments")} className="space-y-2">
      <h4 className="text-sm font-medium">{t("requests.attachments")}</h4>
      <ul className="grid gap-2 sm:grid-cols-3">
        {files.map((f) => (
          <li
            key={f.id}
            data-testid="request-attachment"
            data-kind={f.kind}
            className="min-w-0 rounded-lg border bg-card p-2"
          >
            {f.kind === "image" ? (
              <img
                src={f.url ?? ""}
                alt={f.original_name ?? t("requests.attachment")}
                className="h-28 w-full rounded object-cover"
              />
            ) : (
              <FileText className="mx-auto size-10 text-muted-foreground" aria-hidden />
            )}
            <a
              href={f.url ?? ""}
              target="_blank"
              rel="noopener noreferrer"
              download={f.original_name || undefined}
              className="mt-1 flex items-center gap-1 break-all text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              <Download className="size-3.5 shrink-0" aria-hidden />
              {f.original_name || t("requests.attachment")}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
