import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { EventDialog } from "@/components/events/EventDialog";
import {
  addMediaPhoto,
  addMediaUploadFile,
  createMediaAlbum,
  createMediaUploadRequest,
  deleteMediaAlbum,
  deleteMediaPhotos,
  finishMediaPhoto,
  finishMediaUploadFile,
  moveMediaPhotos,
  submitMediaUploadRequest,
  updateMediaAlbum,
  withdrawMediaUploadRequest,
} from "@/lib/media.functions";
import {
  MAX_REQUEST_PHOTOS,
  movesEventPagePhotos,
  type MediaItemRef,
  type MediaTarget,
} from "@/lib/media";
import { MEDIA_ACCEPT, uploadMediaPhotos, type UploadOutcome } from "@/lib/media-upload";
import { translateError } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { chapterDate } from "./MediaParts";
import { useMediaRefresh, useMediaTargets } from "./use-media";

const SELECT =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ---------------------------------------------------------------------------------------------------------------
// Albums

export type AlbumDraft = {
  id?: string;
  title: string;
  date: string | null;
  description: string | null;
};

export function AlbumDialog({
  branchId,
  album,
  onClose,
  onSaved,
}: {
  branchId: string;
  album: AlbumDraft | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const create = useServerFn(createMediaAlbum),
    update = useServerFn(updateMediaAlbum);
  const refresh = useMediaRefresh();
  const [title, setTitle] = useState(album?.title ?? "");
  const [date, setDate] = useState(album?.date ?? "");
  const [description, setDescription] = useState(album?.description ?? "");
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const fields = {
        title: title.trim(),
        date: date || null,
        description: description.trim() || null,
      };
      const id = album?.id
        ? (await update({ data: { id: album.id, album: fields } }), album.id)
        : await create({ data: { branchId, album: fields } });
      await refresh();
      toast.success(t(album?.id ? "media.albumSaved" : "media.albumCreated"));
      onSaved(id);
    } catch (err) {
      toast.error(translateError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <EventDialog
      open
      onClose={onClose}
      title={t(album?.id ? "media.editAlbum" : "media.newAlbum")}
      testId="media-album-dialog"
    >
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="media-album-title">{t("media.albumTitle")}</Label>
          <Input
            id="media-album-title"
            data-testid="media-album-title"
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="media-album-date">{t("media.albumDate")}</Label>
          <Input
            id="media-album-date"
            data-testid="media-album-date"
            type="date"
            value={date ?? ""}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 w-full sm:w-56"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="media-album-description">{t("media.albumDescription")}</Label>
          <Textarea
            id="media-album-description"
            data-testid="media-album-description"
            maxLength={500}
            rows={3}
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            data-testid="media-album-save"
            className="h-11"
            disabled={busy || !title.trim()}
          >
            {t("common.save")}
          </Button>
        </div>
      </form>
    </EventDialog>
  );
}

/** Deleting an album: its title must be typed; it cannot be undone (photos and files go at once). */
export function DeleteAlbumDialog({
  album,
  onClose,
  onDeleted,
}: {
  album: { id: string; title: string; photo_count: number };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const remove = useServerFn(deleteMediaAlbum);
  const refresh = useMediaRefresh();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === album.title.trim();
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    try {
      await remove({ data: { id: album.id, title: typed } });
      await refresh();
      toast.success(t("media.albumDeleted"));
      onDeleted();
    } catch (err) {
      toast.error(translateError(err));
      setBusy(false);
    }
  }
  return (
    <EventDialog
      open
      onClose={onClose}
      title={t("media.deleteAlbum")}
      testId="media-delete-album-dialog"
    >
      <form onSubmit={confirm} className="space-y-4">
        <p className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>
            {t("media.deleteAlbumWarning", { title: album.title, count: album.photo_count })}
          </span>
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="media-delete-album-confirm">
            {t("media.typeAlbumTitle", { title: album.title })}
          </Label>
          <Input
            id="media-delete-album-confirm"
            data-testid="media-delete-album-confirm"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            data-testid="media-delete-album-submit"
            className="h-11"
            disabled={!matches || busy}
          >
            {t("media.deleteAlbumForever")}
          </Button>
        </div>
      </form>
    </EventDialog>
  );
}

/** Deleting library photos: names what goes and that it cannot be undone. */
export function DeletePhotosDialog({
  ids,
  chapterTitle,
  onClose,
  onDeleted,
}: {
  ids: string[];
  chapterTitle: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const remove = useServerFn(deleteMediaPhotos);
  const refresh = useMediaRefresh();
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await remove({ data: { ids } });
      await refresh();
      toast.success(t("media.photosDeleted", { count: ids.length }));
      onDeleted();
    } catch (err) {
      toast.error(translateError(err));
      setBusy(false);
    }
  }
  return (
    <EventDialog
      open
      onClose={onClose}
      title={t("media.deletePhotos", { count: ids.length })}
      testId="media-delete-photos-dialog"
    >
      <div className="space-y-4">
        <p
          data-testid="media-delete-photos-text"
          className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <span>{t("media.deletePhotosWarning", { count: ids.length, title: chapterTitle })}</span>
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-testid="media-delete-photos-submit"
            className="h-11"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {t("media.deleteForever")}
          </Button>
        </div>
      </div>
    </EventDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Move

/** "Move to…": another album or event chapter of the same branch; event page photos only to albums. */
export function MoveDialog({
  branchId,
  items,
  current,
  onClose,
  onMoved,
}: {
  branchId: string;
  items: MediaItemRef[];
  current: { kind: "album" | "event"; id: string };
  onClose: () => void;
  onMoved: (target: MediaTarget) => void;
}) {
  const { t } = useTranslation();
  const move = useServerFn(moveMediaPhotos);
  const refresh = useMediaRefresh();
  const targets = useMediaTargets(branchId);
  const eventPage = movesEventPagePhotos(items);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    const [kind, id] = value.split(":") as ["album" | "event", string];
    if (!id) return;
    const target: MediaTarget = kind === "album" ? { album_id: id } : { event_id: id };
    setBusy(true);
    try {
      const r = await move({ data: { items, target } });
      await refresh();
      const duplicates = r.skipped.filter((s) => s.reason === "duplicate").length;
      toast.success(
        duplicates
          ? t("media.movedWithDuplicates", { count: r.moved, duplicates })
          : t("media.moved", { count: r.moved }),
      );
      onMoved(target);
    } catch (err) {
      toast.error(translateError(err));
      setBusy(false);
    }
  }
  const albums = (targets.data?.albums ?? []).filter(
    (a) => !(current.kind === "album" && a.id === current.id),
  );
  const events = eventPage
    ? []
    : (targets.data?.events ?? []).filter(
        (ev) => !(current.kind === "event" && ev.id === current.id),
      );
  return (
    <EventDialog
      open
      onClose={onClose}
      title={t("media.moveTitle", { count: items.length })}
      testId="media-move-dialog"
    >
      <form onSubmit={confirm} className="space-y-4">
        {eventPage && (
          <p
            data-testid="media-move-event-warning"
            className="flex gap-2 rounded-lg border border-media-amber bg-media-amber/10 p-3 text-sm"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-media-amber-text" aria-hidden />
            <span>{t("media.moveEventPageWarning")}</span>
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="media-move-target">{t("media.moveTo")}</Label>
          <select
            id="media-move-target"
            data-testid="media-move-target"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={SELECT}
          >
            <option value="" disabled>
              {targets.isLoading ? t("common.loading") : t("media.chooseTarget")}
            </option>
            {albums.length > 0 && (
              <optgroup label={t("media.albums")}>
                {albums.map((a) => (
                  <option key={a.id} value={`album:${a.id}`}>
                    {a.title}
                  </option>
                ))}
              </optgroup>
            )}
            {events.length > 0 && (
              <optgroup label={t("media.events")}>
                {events.map((ev) => (
                  <option key={ev.id} value={`event:${ev.id}`}>
                    {[ev.title, chapterDate(ev.date)].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="text-xs text-muted-foreground">{t("media.moveHint")}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            data-testid="media-move-submit"
            className="h-11"
            disabled={!value || busy}
          >
            {busy ? t("media.moving") : t("media.move")}
          </Button>
        </div>
      </form>
    </EventDialog>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Add photos (managers) / Request upload (volunteers)

type TargetChoice = { kind: "album" | "event"; id: string } | { kind: "new"; title: string };

/**
 * Managers add photos straight into an album or event chapter (or a new album); volunteers send an upload request
 * (album, event or a proposed album title, up to 20 photos, optional note) that waits for the branch's review.
 */
export function UploadDialog({
  branchId,
  mode,
  initial,
  onClose,
  onDone,
}: {
  branchId: string;
  mode: "direct" | "request";
  initial?: { kind: "album" | "event"; id: string } | null;
  onClose: () => void;
  onDone: (target: MediaTarget | null) => void;
}) {
  const { t } = useTranslation();
  const targets = useMediaTargets(branchId);
  const refresh = useMediaRefresh();
  const createAlbum = useServerFn(createMediaAlbum),
    reservePhoto = useServerFn(addMediaPhoto),
    finishPhoto = useServerFn(finishMediaPhoto),
    createRequest = useServerFn(createMediaUploadRequest),
    reserveFile = useServerFn(addMediaUploadFile),
    finishFile = useServerFn(finishMediaUploadFile),
    submit = useServerFn(submitMediaUploadRequest),
    withdraw = useServerFn(withdrawMediaUploadRequest);
  const [choice, setChoice] = useState<string>(initial ? `${initial.kind}:${initial.id}` : "");
  const [newTitle, setNewTitle] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [handled, setHandled] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<UploadOutcome[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const tooMany = mode === "request" && files.length > MAX_REQUEST_PHOTOS;
  const target: TargetChoice | null = useMemo(() => {
    if (choice === "new") return newTitle.trim() ? { kind: "new", title: newTitle.trim() } : null;
    const [kind, id] = choice.split(":");
    return (kind === "album" || kind === "event") && id ? { kind, id } : null;
  }, [choice, newTitle]);
  const busy = handled !== null && outcomes === null;

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !files.length || tooMany) return;
    setHandled(0);
    try {
      if (mode === "direct") {
        const dest: MediaTarget =
          target.kind === "new"
            ? {
                album_id: await createAlbum({ data: { branchId, album: { title: target.title } } }),
              }
            : target.kind === "album"
              ? { album_id: target.id }
              : { event_id: target.id };
        const result = await uploadMediaPhotos(
          files,
          {
            reserve: (p) =>
              reservePhoto({
                data: { branchId, target: dest, extension: "webp", name: p.name, hash: p.hash },
              }),
            finish: (id, p) => finishPhoto({ data: { id, width: p.width, height: p.height } }),
          },
          setHandled,
        );
        setOutcomes(result);
        await refresh();
        const added = result.filter((o) => o.status === "added").length;
        if (added) toast.success(t("media.uploaded", { count: added }));
        if (result.every((o) => o.status !== "failed")) onDone(dest);
      } else {
        const requestTarget =
          target.kind === "new"
            ? { proposed_title: target.title }
            : target.kind === "album"
              ? { album_id: target.id }
              : { event_id: target.id };
        const requestId = await createRequest({
          data: { target: requestTarget, note: note.trim() || undefined },
        });
        const result = await uploadMediaPhotos(
          files,
          {
            reserve: (p) =>
              reserveFile({ data: { requestId, extension: "webp", name: p.name, hash: p.hash } }),
            finish: (id, p) => finishFile({ data: { id, width: p.width, height: p.height } }),
          },
          setHandled,
        );
        setOutcomes(result);
        if (result.some((o) => o.status === "added")) {
          await submit({ data: { id: requestId } });
          toast.success(t("media.requestSent"));
          await refresh();
          if (result.every((o) => o.status !== "failed")) onDone(null);
        } else {
          // Nothing could be stored: the request is withdrawn instead of waiting empty.
          await withdraw({ data: { id: requestId } }).catch(() => undefined);
          toast.error(t("media.nothingUploaded"));
        }
      }
    } catch (err) {
      toast.error(translateError(err));
      setHandled(null);
    }
  }

  const summary = outcomes && {
    added: outcomes.filter((o) => o.status === "added").length,
    duplicates: outcomes.filter((o) => o.status === "duplicate").map((o) => o.name),
    failed: outcomes.filter((o) => o.status === "failed").map((o) => o.name),
  };
  return (
    <EventDialog
      open
      onClose={() => !busy && onClose()}
      title={t(mode === "direct" ? "media.addPhotos" : "media.requestUpload")}
      testId="media-upload-dialog"
    >
      {summary ? (
        <div data-testid="media-upload-summary" className="space-y-3">
          <p className="font-medium">
            {mode === "direct"
              ? t("media.uploaded", { count: summary.added })
              : t("media.requestSentCount", { count: summary.added })}
          </p>
          {summary.duplicates.length > 0 && (
            <p data-testid="media-upload-duplicates" className="text-sm text-muted-foreground">
              {t("media.duplicatesSkipped", {
                count: summary.duplicates.length,
                names: summary.duplicates.join(", "),
              })}
            </p>
          )}
          {summary.failed.length > 0 && (
            <p data-testid="media-upload-failed" className="text-sm text-destructive">
              {t("media.uploadFailed", {
                count: summary.failed.length,
                names: summary.failed.join(", "),
              })}
            </p>
          )}
          <div className="flex justify-end">
            <Button className="h-11" data-testid="media-upload-done" onClick={() => onDone(null)}>
              {t("media.close")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={run} className="space-y-4">
          {mode === "request" && (
            <p className="text-sm text-muted-foreground">{t("media.requestIntro")}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="media-upload-target">
              {t(mode === "direct" ? "media.addTo" : "media.requestFor")}
            </Label>
            <select
              id="media-upload-target"
              data-testid="media-upload-target"
              required
              value={choice}
              disabled={busy}
              onChange={(e) => setChoice(e.target.value)}
              className={SELECT}
            >
              <option value="" disabled>
                {targets.isLoading ? t("common.loading") : t("media.chooseTarget")}
              </option>
              <option value="new">
                {t(mode === "direct" ? "media.newAlbumOption" : "media.proposeAlbumOption")}
              </option>
              {(targets.data?.albums.length ?? 0) > 0 && (
                <optgroup label={t("media.albums")}>
                  {targets.data!.albums.map((a) => (
                    <option key={a.id} value={`album:${a.id}`}>
                      {a.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {(targets.data?.events.length ?? 0) > 0 && (
                <optgroup label={t("media.events")}>
                  {targets.data!.events.map((ev) => (
                    <option key={ev.id} value={`event:${ev.id}`}>
                      {[ev.title, chapterDate(ev.date)].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {choice === "new" && (
            <div className="space-y-1.5">
              <Label htmlFor="media-upload-new-title">
                {t(mode === "direct" ? "media.albumTitle" : "media.proposedTitle")}
              </Label>
              <Input
                id="media-upload-new-title"
                data-testid="media-upload-new-title"
                required
                maxLength={120}
                value={newTitle}
                disabled={busy}
                onChange={(e) => setNewTitle(e.target.value)}
                className="h-11"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{t("media.photos")}</span>
            <input
              ref={input}
              data-testid="media-upload-files"
              type="file"
              accept={MEDIA_ACCEPT}
              multiple
              className="sr-only"
              aria-label={t("media.choosePhotos")}
              disabled={busy}
              onChange={(e) => setFiles([...(e.target.files ?? [])])}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full justify-start gap-2"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <ImagePlus className="size-4" aria-hidden />
              {files.length
                ? t("media.photosChosen", { count: files.length })
                : t("media.choosePhotos")}
            </Button>
            <p
              className={tooMany ? "text-sm text-destructive" : "text-xs text-muted-foreground"}
              data-testid="media-upload-hint"
            >
              {tooMany
                ? t("media.tooManyPhotos", { max: MAX_REQUEST_PHOTOS })
                : t(mode === "request" ? "media.requestFileHint" : "media.fileHint", {
                    max: MAX_REQUEST_PHOTOS,
                  })}
            </p>
          </div>
          {mode === "request" && (
            <div className="space-y-1.5">
              <Label htmlFor="media-upload-note">{t("media.note")}</Label>
              <Textarea
                id="media-upload-note"
                data-testid="media-upload-note"
                maxLength={500}
                rows={3}
                value={note}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          {handled !== null && (
            <div className="space-y-1.5" aria-live="polite">
              <Progress value={(handled / Math.max(1, files.length)) * 100} />
              <p className="text-xs text-muted-foreground">
                {t("media.uploading", { n: handled, count: files.length })}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              data-testid="media-upload-submit"
              className="h-11"
              disabled={busy || !target || !files.length || tooMany}
            >
              {t(mode === "direct" ? "media.upload" : "media.sendRequest")}
            </Button>
          </div>
        </form>
      )}
    </EventDialog>
  );
}
