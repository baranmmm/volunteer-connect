import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Clock, Download, Ban, Hourglass } from "lucide-react";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { getMediaDownload, getMediaDownloadFiles } from "@/lib/media.functions";
import { downloadWindowOpen, type MediaDownloadFiles } from "@/lib/media";
import { formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";

// The link in a "download request approved" notice: the requester's photos in full size for 24 hours. The page shows
// previews; the full-size files are signed only when the member asks for them (the server checks the requester, the
// approval and the window again). An expired, declined or unknown link says so clearly.
export const Route = createFileRoute("/_app/media_/download/$id")({
  ssr: false,
  head: () => pageHead("Photo download", "Download the photos your request was approved for."),
  component: DownloadPage,
});

function DownloadPage() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const fetch = useServerFn(getMediaDownload),
    files = useServerFn(getMediaDownloadFiles);
  const request = useQuery({
    queryKey: ["media", "download", id],
    queryFn: () => fetch({ data: { id } }),
    staleTime: 60_000,
    retry: false,
  });
  const [signed, setSigned] = useState<MediaDownloadFiles | null>(null);
  const [busy, setBusy] = useState(false);
  const r = request.data;
  async function prepare() {
    setBusy(true);
    try {
      setSigned(await files({ data: { id } }));
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  }
  const expired =
    signed?.state === "expired" || (r?.status === "approved" && (!!r.expired || !downloadWindowOpen(r.expires_at)));
  return (
    <div data-testid="media-download-page" className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/media"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("media.downloads.backToMedia")}
      </Link>
      <h1 className="text-3xl font-bold">{t("media.downloads.pageTitle")}</h1>
      {request.isLoading ? (
        <p className="text-muted-foreground">{t("common.loading")}</p>
      ) : !r ? (
        <Notice testId="media-download-missing" icon={<Ban className="size-5" aria-hidden />}>
          {t("media.downloads.missing")}
        </Notice>
      ) : r.status === "submitted" ? (
        <Notice testId="media-download-waiting" icon={<Hourglass className="size-5" aria-hidden />}>
          {t("media.downloads.waiting")}
        </Notice>
      ) : r.status === "declined" ? (
        <Notice testId="media-download-declined" icon={<Ban className="size-5" aria-hidden />}>
          {r.decline_reason
            ? t("media.downloads.declinedReason", { reason: r.decline_reason })
            : t("media.downloads.declined")}
        </Notice>
      ) : r.status === "withdrawn" ? (
        <Notice testId="media-download-withdrawn" icon={<Ban className="size-5" aria-hidden />}>
          {t("media.downloads.withdrawn")}
        </Notice>
      ) : expired ? (
        <Notice testId="media-download-expired" icon={<Clock className="size-5" aria-hidden />}>
          {t("media.downloads.expired", {
            when: r.expires_at ? formatDate(r.expires_at, { dateStyle: "medium", timeStyle: "short" }) : "",
          })}
        </Notice>
      ) : (
        <div className="space-y-4">
          <p data-testid="media-download-valid" className="text-sm text-muted-foreground">
            {t("media.downloads.validUntil", {
              when: formatDate(r.expires_at!, { dateStyle: "medium", timeStyle: "short" }),
              count: r.items.length,
            })}
          </p>
          {!signed && (
            <Button data-testid="media-download-prepare" className="h-11" disabled={busy} onClick={() => void prepare()}>
              <Download className="size-4" aria-hidden />
              {t("media.downloads.prepare", { count: r.items.length })}
            </Button>
          )}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {r.items.map((item, i) => {
              const file = signed?.state === "ready" ? signed.files.find((f) => f.item_id === item.id) : null;
              return (
                <li key={item.id} data-testid="media-download-item" className="space-y-2 rounded-xl border bg-card p-2">
                  {item.thumb ? (
                    <img src={item.thumb} alt={t("media.downloads.photoN", { n: i + 1 })} className="aspect-[4/3] w-full rounded-lg object-cover" />
                  ) : (
                    <div className="aspect-[4/3] w-full rounded-lg bg-muted" />
                  )}
                  {file && (
                    <a
                      href={file.url}
                      download={file.name}
                      data-testid="media-download-file"
                      className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Download className="size-4" aria-hidden />
                      {t("media.downloads.fileN", { n: i + 1 })}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Notice({ testId, icon, children }: { testId: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p data-testid={testId} role="status" className="flex items-start gap-3 rounded-2xl border bg-card p-5 text-base">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
