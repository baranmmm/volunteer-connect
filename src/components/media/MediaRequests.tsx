import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Check, Download, Images } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RequestStatusBadge } from "@/components/requests/RequestStatusBadge";
import {
  approveMediaDownloadRequest,
  approveMediaUploadRequest,
  declineMediaDownloadRequest,
  declineMediaUploadRequest,
  withdrawMediaDownloadRequest,
  withdrawMediaUploadRequest,
} from "@/lib/media.functions";
import {
  downloadWindowOpen,
  type MediaDownloadRequest,
  type MediaUploadRequest,
} from "@/lib/media";
import { formatDate, translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useMediaDownloadRequests, useMediaRefresh, useMediaRequests } from "./use-media";

// "Media upload" requests on /requests: the volunteer's own (My requests) and, for the branch's BM and the region's
// RD, the ones waiting for review (with photo previews: approve all, approve some, or decline with a reason).

/** Withdrawn and still-uploading requests show as withdrawn / submitted in the shared status badge. */
const badgeStatus = (s: MediaUploadRequest["status"]) => (s === "uploading" ? "submitted" : s);

function RequestHeading({ r }: { r: MediaUploadRequest }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <Badge variant="secondary" className="mb-1.5 gap-1">
          <Images className="size-3.5" aria-hidden />
          {t("requests.kinds.media")}
        </Badge>
        <h3 data-testid="media-request-title" className="font-semibold">
          {r.status === "submitted" && !r.album_id && !r.event_id
            ? t("media.requests.newAlbumTitle", { title: r.target_title ?? "" })
            : (r.target_title ?? "")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {[
            r.requester_name,
            t("media.photoCount", {
              count: r.status === "approved" ? (r.added_count ?? 0) : r.file_count,
            }),
            formatDate(r.submitted_at ?? r.created_at, { dateStyle: "medium" }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <RequestStatusBadge status={badgeStatus(r.status)} testId="media-request-status" />
    </div>
  );
}

export function MyMediaRequests({ filter }: { filter: "all" | "open" | "decided" }) {
  const { t } = useTranslation();
  const requests = useMediaRequests("mine");
  const withdraw = useServerFn(withdrawMediaUploadRequest);
  const refresh = useMediaRefresh();
  const list = (requests.data ?? []).filter((r) =>
    filter === "all"
      ? true
      : filter === "open"
        ? r.status === "submitted" || r.status === "uploading"
        : r.status !== "submitted" && r.status !== "uploading",
  );
  if (!list.length) return null;
  return (
    <section
      data-testid="my-media-requests"
      aria-labelledby="my-media-requests-h"
      className="space-y-3"
    >
      <h2 id="my-media-requests-h" className="text-lg font-semibold">
        {t("media.requests.mine")}
      </h2>
      <ul className="space-y-3">
        {list.map((r) => (
          <li
            key={r.id}
            data-testid="media-request"
            data-request-id={r.id}
            data-status={r.status}
            className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft"
          >
            <RequestHeading r={r} />
            <Previews r={r} />
            {r.note && (
              <p className="text-sm">
                <span className="font-medium">{t("media.note")}: </span>
                {r.note}
              </p>
            )}
            {r.status === "approved" && (
              <p className="text-sm">
                {t("media.requests.approvedText", { count: r.added_count ?? 0 })}{" "}
                <Link
                  data-testid="media-request-open"
                  to="/media"
                  search={
                    r.result_album_id
                      ? { album: r.result_album_id }
                      : { event: r.result_event_id ?? undefined }
                  }
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("media.requests.openChapter")}
                </Link>
              </p>
            )}
            {r.status === "declined" && (
              <p data-testid="media-request-reason" className="text-sm">
                {r.decline_reason
                  ? t("media.requests.declinedReason", { reason: r.decline_reason })
                  : t("media.requests.declinedText")}
              </p>
            )}
            {r.can_withdraw && (
              <Button
                data-testid="media-request-withdraw"
                variant="outline"
                className="h-11"
                onClick={() =>
                  void withdraw({ data: { id: r.id } })
                    .then(async () => {
                      await refresh();
                      toast.success(t("media.requests.withdrawn"));
                    })
                    .catch((e) => toast.error(translateError(e)))
                }
              >
                {t("media.requests.withdraw")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Previews({
  r,
  selected,
  onToggle,
}: {
  r: MediaUploadRequest;
  selected?: string[];
  onToggle?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const files = r.files.filter((f) => f.ready);
  if (!files.length) return null;
  return (
    <ul data-testid="media-request-previews" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {files.map((f, i) => {
        const on = selected?.includes(f.id) ?? false;
        const label = t("media.requests.photoN", { n: i + 1, name: f.original_name ?? "" });
        const img = f.thumb ? (
          <img
            src={f.thumb}
            alt={onToggle ? "" : label}
            className="aspect-square w-full rounded-lg object-cover"
          />
        ) : null;
        return (
          <li key={f.id} className="relative">
            {onToggle ? (
              <button
                type="button"
                data-testid="media-request-file"
                data-file-id={f.id}
                aria-pressed={on}
                aria-label={t(on ? "media.requests.deselect" : "media.requests.select", {
                  photo: label,
                })}
                onClick={() => onToggle(f.id)}
                className={cn(
                  "block w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "ring-4 ring-primary ring-offset-2" : "opacity-50",
                )}
              >
                {img}
                <span
                  aria-hidden
                  className={cn(
                    "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border-2 border-white",
                    on ? "bg-primary text-primary-foreground" : "bg-black/40",
                  )}
                >
                  {on && <Check className="size-3.5" />}
                </span>
              </button>
            ) : (
              img
            )}
            {f.duplicate && (
              <span
                data-testid="media-request-duplicate"
                className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white"
              >
                {t("media.requests.duplicate")}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReviewCard({ r }: { r: MediaUploadRequest }) {
  const { t } = useTranslation();
  const approve = useServerFn(approveMediaUploadRequest),
    decline = useServerFn(declineMediaUploadRequest);
  const refresh = useMediaRefresh();
  const ready = r.files.filter((f) => f.ready);
  const [selected, setSelected] = useState(() =>
    ready.filter((f) => !f.duplicate).map((f) => f.id),
  );
  const [albumTitle, setAlbumTitle] = useState(r.proposed_title ?? "");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const proposed = !r.album_id && !r.event_id;
  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.success(await fn());
      await refresh();
    } catch (e) {
      toast.error(translateError(e));
      setBusy(false);
    }
  };
  return (
    <li
      data-testid="media-review-request"
      data-request-id={r.id}
      className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft"
    >
      <RequestHeading r={r} />
      {r.note && (
        <p className="text-sm">
          <span className="font-medium">{t("media.note")}: </span>
          {r.note}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t("media.requests.selectHint")}</p>
      <Previews
        r={r}
        selected={selected}
        onToggle={(id) =>
          setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
        }
      />
      {proposed && (
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor={`media-review-album-${r.id}`}>{t("media.requests.albumTitle")}</Label>
          <Input
            id={`media-review-album-${r.id}`}
            data-testid="media-review-album-title"
            maxLength={120}
            value={albumTitle}
            onChange={(e) => setAlbumTitle(e.target.value)}
            className="h-11"
          />
        </div>
      )}
      {declining ? (
        <div className="space-y-2">
          <Label htmlFor={`media-review-reason-${r.id}`}>{t("media.requests.reason")}</Label>
          <Textarea
            id={`media-review-reason-${r.id}`}
            data-testid="media-review-reason"
            maxLength={500}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="media-review-decline-confirm"
              variant="destructive"
              className="h-11"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await decline({ data: { id: r.id, reason } });
                  return t("media.requests.declinedToast");
                })
              }
            >
              {t("media.requests.decline")}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => setDeclining(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="media-review-approve"
            className="h-11"
            disabled={busy || !selected.length || (proposed && !albumTitle.trim())}
            onClick={() =>
              void act(async () => {
                const res = await approve({
                  data: {
                    id: r.id,
                    fileIds: selected,
                    ...(proposed ? { albumTitle: albumTitle.trim() } : {}),
                  },
                });
                return res.skipped
                  ? t("media.requests.approvedWithDuplicates", {
                      count: res.added,
                      duplicates: res.skipped,
                    })
                  : t("media.requests.approvedToast", { count: res.added });
              })
            }
          >
            {selected.length === ready.length
              ? t("media.requests.approveAll", { count: selected.length })
              : t("media.requests.approveSome", { count: selected.length })}
          </Button>
          <Button
            data-testid="media-review-decline"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => setDeclining(true)}
          >
            {t("media.requests.decline")}
          </Button>
        </div>
      )}
    </li>
  );
}

export function ReviewMediaRequests({ filter }: { filter: "open" | "decided" }) {
  const { t } = useTranslation();
  const requests = useMediaRequests("review");
  const list = (requests.data ?? []).filter((r) =>
    filter === "open" ? r.status === "submitted" : r.status !== "submitted",
  );
  if (!list.length) return null;
  return (
    <section
      data-testid={`media-review-${filter}`}
      aria-labelledby={`media-review-${filter}-h`}
      className="space-y-3"
    >
      <h2 id={`media-review-${filter}-h`} className="text-lg font-semibold">
        {t("media.requests.review")}
      </h2>
      <ul className="space-y-3">
        {list.map((r) =>
          filter === "open" && r.can_review ? (
            <ReviewCard key={r.id} r={r} />
          ) : (
            <li
              key={r.id}
              data-testid="media-review-request"
              data-request-id={r.id}
              data-status={r.status}
              className="space-y-3 rounded-2xl border bg-card p-4"
            >
              <RequestHeading r={r} />
              {r.status === "declined" && r.decline_reason && (
                <p className="text-sm">
                  {t("media.requests.declinedReason", { reason: r.decline_reason })}
                </p>
              )}
              {r.reviewer_name && (
                <p className="text-xs text-muted-foreground">
                  {t("media.requests.decidedBy", { name: r.reviewer_name })}
                </p>
              )}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Download requests (volunteers and trustees → the branch's BM / the region's RD)

function DownloadHeading({ r }: { r: MediaDownloadRequest }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <Badge variant="secondary" className="mb-1.5 gap-1">
          <Download className="size-3.5" aria-hidden />
          {t("requests.kinds.mediaDownload")}
        </Badge>
        <h3 data-testid="media-download-request-title" className="font-semibold">
          {t("media.downloads.requestTitle", { count: r.items.length })}
        </h3>
        <p className="text-sm text-muted-foreground">
          {[r.requester_name, formatDate(r.created_at, { dateStyle: "medium" })]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <RequestStatusBadge status={r.status} testId="media-download-request-status" />
    </div>
  );
}

function DownloadPreviews({ r }: { r: MediaDownloadRequest }) {
  const { t } = useTranslation();
  if (!r.items.length) return null;
  return (
    <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {r.items.map((i, n) => (
        <li key={i.id}>
          {i.thumb ? (
            <img
              src={i.thumb}
              alt={t("media.downloads.photoN", { n: n + 1 })}
              className="aspect-square w-full rounded-lg object-cover"
            />
          ) : (
            <div className="aspect-square w-full rounded-lg bg-muted" />
          )}
        </li>
      ))}
    </ul>
  );
}

export function MyDownloadRequests({ filter }: { filter: "all" | "open" | "decided" }) {
  const { t } = useTranslation();
  const requests = useMediaDownloadRequests("mine");
  const withdraw = useServerFn(withdrawMediaDownloadRequest);
  const refresh = useMediaRefresh();
  const list = (requests.data ?? []).filter((r) =>
    filter === "all"
      ? true
      : filter === "open"
        ? r.status === "submitted"
        : r.status !== "submitted",
  );
  if (!list.length) return null;
  return (
    <section
      data-testid="my-download-requests"
      aria-labelledby="my-download-requests-h"
      className="space-y-3"
    >
      <h2 id="my-download-requests-h" className="text-lg font-semibold">
        {t("media.downloads.mine")}
      </h2>
      <ul className="space-y-3">
        {list.map((r) => (
          <li
            key={r.id}
            data-testid="media-download-request"
            data-request-id={r.id}
            data-status={r.status}
            className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft"
          >
            <DownloadHeading r={r} />
            <DownloadPreviews r={r} />
            {r.reason && (
              <p className="text-sm">
                <span className="font-medium">{t("media.downloads.reasonLabel")}: </span>
                {r.reason}
              </p>
            )}
            {r.status === "approved" &&
              (downloadWindowOpen(r.expires_at) ? (
                <Link
                  data-testid="media-download-open"
                  to="/media/download/$id"
                  params={{ id: r.id }}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Download className="size-4" aria-hidden />
                  {t("media.downloads.open")}
                </Link>
              ) : (
                <p
                  data-testid="media-download-expired-note"
                  className="text-sm text-muted-foreground"
                >
                  {t("media.downloads.expiredShort")}
                </p>
              ))}
            {r.status === "declined" && (
              <p data-testid="media-download-reason" className="text-sm">
                {r.decline_reason
                  ? t("media.downloads.declinedReason", { reason: r.decline_reason })
                  : t("media.downloads.declined")}
              </p>
            )}
            {r.can_withdraw && (
              <Button
                data-testid="media-download-withdraw"
                variant="outline"
                className="h-11"
                onClick={() =>
                  void withdraw({ data: { id: r.id } })
                    .then(async () => {
                      await refresh();
                      toast.success(t("media.requests.withdrawn"));
                    })
                    .catch((e) => toast.error(translateError(e)))
                }
              >
                {t("media.requests.withdraw")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DownloadReviewCard({ r }: { r: MediaDownloadRequest }) {
  const { t } = useTranslation();
  const approve = useServerFn(approveMediaDownloadRequest),
    decline = useServerFn(declineMediaDownloadRequest);
  const refresh = useMediaRefresh();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(done);
    } catch (e) {
      toast.error(translateError(e));
      setBusy(false);
    }
  };
  return (
    <li
      data-testid="media-download-review"
      data-request-id={r.id}
      className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft"
    >
      <DownloadHeading r={r} />
      <DownloadPreviews r={r} />
      {r.reason && (
        <p className="text-sm">
          <span className="font-medium">{t("media.downloads.reasonLabel")}: </span>
          {r.reason}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t("media.downloads.reviewHint")}</p>
      {declining ? (
        <div className="space-y-2">
          <Label htmlFor={`media-download-decline-${r.id}`}>{t("media.requests.reason")}</Label>
          <Textarea
            id={`media-download-decline-${r.id}`}
            data-testid="media-download-decline-reason"
            maxLength={500}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="media-download-decline-confirm"
              variant="destructive"
              className="h-11"
              disabled={busy}
              onClick={() =>
                void act(
                  () => decline({ data: { id: r.id, reason } }),
                  t("media.downloads.declinedToast"),
                )
              }
            >
              {t("media.requests.decline")}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => setDeclining(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="media-download-approve"
            className="h-11"
            disabled={busy}
            onClick={() =>
              void act(() => approve({ data: { id: r.id } }), t("media.downloads.approvedToast"))
            }
          >
            {t("media.downloads.approve")}
          </Button>
          <Button
            data-testid="media-download-decline"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => setDeclining(true)}
          >
            {t("media.requests.decline")}
          </Button>
        </div>
      )}
    </li>
  );
}

export function ReviewDownloadRequests({ filter }: { filter: "open" | "decided" }) {
  const { t } = useTranslation();
  const requests = useMediaDownloadRequests("review");
  const list = (requests.data ?? []).filter((r) =>
    filter === "open" ? r.status === "submitted" : r.status !== "submitted",
  );
  if (!list.length) return null;
  return (
    <section
      data-testid={`media-download-review-${filter}`}
      aria-labelledby={`media-download-review-${filter}-h`}
      className="space-y-3"
    >
      <h2 id={`media-download-review-${filter}-h`} className="text-lg font-semibold">
        {t("media.downloads.review")}
      </h2>
      <ul className="space-y-3">
        {list.map((r) =>
          filter === "open" && r.can_review ? (
            <DownloadReviewCard key={r.id} r={r} />
          ) : (
            <li
              key={r.id}
              data-testid="media-download-review"
              data-request-id={r.id}
              data-status={r.status}
              className="space-y-3 rounded-2xl border bg-card p-4"
            >
              <DownloadHeading r={r} />
              {r.reviewer_name && (
                <p className="text-xs text-muted-foreground">
                  {t("media.requests.decidedBy", { name: r.reviewer_name })}
                </p>
              )}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
